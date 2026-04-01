/**
 * Subagent Opportunity Detector
 *
 * Identifies sessions where the user could have delegated work to subagents
 * instead of reading files directly in the main context.
 */

import type { SessionData, DetectorResult, Remediation } from '../types.js';

interface SubagentEvidence {
  sessionsWithOpportunity: number;
  totalSessions: number;
  opportunityRate: number;
  avgChainLength: number;
  examples: Array<{
    slug: string;
    project: string;
    chainLength: number;
    filesExplored: number;
    date: string;
  }>;
}

function findReadChains(session: SessionData): { chainLength: number; filesExplored: number } | null {
  const readTools = ['Read', 'Glob', 'Grep'];
  let chainLength = 0;
  let maxChain = 0;
  let totalFiles = 0;

  for (const tool of session.toolUses) {
    if (readTools.includes(tool.name)) {
      chainLength++;
      totalFiles++;
      maxChain = Math.max(maxChain, chainLength);
    } else if (chainLength > 0) {
      chainLength = 0;
    }
  }

  if (maxChain >= 5) {
    return { chainLength: maxChain, filesExplored: totalFiles };
  }
  return null;
}

export function detectSubagentOpportunity(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  const opportunities: Array<{
    session: SessionData;
    chainLength: number;
    filesExplored: number;
  }> = [];

  for (const session of sessions) {
    const result = findReadChains(session);
    if (result) {
      opportunities.push({
        session,
        chainLength: result.chainLength,
        filesExplored: result.filesExplored,
      });
    }
  }

  if (opportunities.length === 0) return null;

  const opportunityRate = (opportunities.length / sessions.length) * 100;
  const avgChainLength =
    opportunities.reduce((sum, o) => sum + o.chainLength, 0) / opportunities.length;

  const examples = opportunities
    .sort((a, b) => b.chainLength - a.chainLength)
    .slice(0, 5)
    .map((o) => ({
      slug: o.session.slug,
      project: o.session.project,
      chainLength: o.chainLength,
      filesExplored: o.filesExplored,
      date: o.session.startedAt.split('T')[0] ?? '',
    }));

  const totalTokens = sessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );

  const estimatedSavings = opportunities.reduce(
    (sum, o) => sum + o.filesExplored * 2000,
    0
  );

  const savingsPercent = totalTokens > 0 ? Math.round((estimatedSavings / totalTokens) * 100) : 0;

  const severity: 'high' | 'medium' | 'low' =
    opportunityRate > 40 ? 'high' : opportunityRate > 20 ? 'medium' : 'low';

  const confidence = Math.min(0.85, 0.5 + opportunities.length * 0.03);

  const evidence: SubagentEvidence = {
    sessionsWithOpportunity: opportunities.length,
    totalSessions: sessions.length,
    opportunityRate: Math.round(opportunityRate),
    avgChainLength: Math.round(avgChainLength * 10) / 10,
    examples,
  };

  const remediation = buildSubagentRemediation(evidence, estimatedSavings);

  // Pre-render session breakdown grouped by project
  const byProject = new Map<string, typeof evidence.examples>();
  for (const ex of evidence.examples) {
    const list = byProject.get(ex.project) ?? [];
    list.push(ex);
    byProject.set(ex.project, list);
  }
  const sessionBreakdown = [...byProject.entries()]
    .map(([project, exs]) => {
      const rows = exs.map((ex) =>
        `  - **${ex.project}**: **${ex.chainLength} consecutive reads**, ${ex.filesExplored} files explored inline (all landed in main context)`
      ).join('\n');
      return `**${project}**\n${rows}`;
    }).join('\n\n');

  return {
    detector: 'subagent-opportunity',
    title: 'Subagent Opportunity',
    severity,
    savingsPercent,
    savingsTokens: estimatedSavings,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdown || '_No specific sessions to call out._',
  };
}

function buildSubagentRemediation(evidence: SubagentEvidence, estimatedSavings: number): Remediation {
  const worst = evidence.examples[0];

  // Group by project
  const byProject = new Map<string, { count: number; maxChain: number; filesExplored: number }>();
  for (const ex of evidence.examples) {
    const existing = byProject.get(ex.project);
    if (!existing || ex.chainLength > existing.maxChain) {
      byProject.set(ex.project, {
        count: (existing?.count ?? 0) + 1,
        maxChain: ex.chainLength,
        filesExplored: ex.filesExplored,
      });
    }
  }
  const projectLines = [...byProject.entries()]
    .sort((a, b) => b[1].maxChain - a[1].maxChain)
    .map(([proj, d]) => `**${proj}** (${d.maxChain} consecutive reads, ${d.filesExplored} files)`)
    .join('; ');

  return {
    problem: `${evidence.sessionsWithOpportunity} sessions (${evidence.opportunityRate}%) included long chains of file reads (${evidence.avgChainLength} reads average) that happened directly in the main conversation. Affected projects: ${projectLines || 'multiple projects'}. Each file read adds its full content to the context window permanently — you pay for it on every subsequent turn, even if you only needed one line from that file.`,

    whyItMatters: `When you ask Claude to "explore the codebase" or "understand how this module works," it reads files one by one. ${worst ? `Your worst case was **${worst.project}** with ${worst.chainLength} consecutive reads across ${worst.filesExplored} files — all that content entered the main context and stayed there for the entire session. ` : ''}The solution: Claude can delegate exploration to an isolated "subagent" session. The subagent reads all the files it needs, but only the summary comes back to your main conversation. The file contents never pollute your context.`,

    steps: [
      {
        action: 'Delegate exploration and verbose operations to subagents',
        howTo: 'For any task involving broad reading, ask Claude to use a subagent to explore the relevant module and summarize the key files, patterns, and entry points. Subagents are isolated Claude sessions — they can read, search, and process files without any of that content entering your main conversation. Also delegate: running tests (verbose output stays isolated), processing log files (only errors come back), fetching documentation.',
        impact: `Eliminates ${estimatedSavings > 1000 ? `${Math.round(estimatedSavings / 1000)}K` : estimatedSavings} tokens of file content from entering your main context per affected session.`,
      },
      {
        action: 'Create reusable instruction files for recurring exploration tasks',
        howTo: 'If you frequently ask Claude to understand a codebase or module, create a reusable instruction file (e.g., a markdown document) that captures your project\'s key directories, naming conventions, entry points, and core patterns. When Claude loads these instructions, it gets architecture context instantly — no file reads needed. This eliminates the exploration chain entirely for "how does this codebase work" questions.',
        impact: 'Prevents exploration chains entirely. One instruction file load replaces 5-20 file reads.',
      },
      {
        action: 'Use a lighter model for subagent tasks',
        howTo: 'When delegating to a subagent, consider requesting a lighter model for mechanical work: file searches, test runs, log parsing, dependency checks. Reserve more capable models for subagents that need deep reasoning or complex analysis. Mechanical exploration tasks produce the same results regardless of model tier.',
        impact: 'Subagent tasks on lighter models use 10-20x fewer tokens, making delegation highly efficient from a token perspective.',
      },
    ],

    examples: [
      {
        label: 'Exploration delegation',
        before: '"Look at the auth module and tell me how it works" → Claude reads 15 files sequentially, all entering main context',
        after: '"Use a subagent to explore the auth module and summarize the key files and patterns" → Subagent reads 15 files in isolation, only the 200-word summary enters your main context',
      },
      {
        label: 'Test output isolation',
        before: '"Run the full test suite" → 500 lines of test output permanently in your context',
        after: '"Use a subagent to run the tests and report only failures" → Subagent runs tests, only the 5 failing test names come back',
      },
    ],

    quickWin: 'Next time you ask Claude to explore a module or understand code, prefix your request with: "Use a subagent to..." — the exploration happens in isolation and only the summary enters your main context.',
    specificQuickWin: (() => {
      const top = evidence.examples.slice(0, 2);
      if (top.length === 0) return 'Prefix exploration requests with "Use a subagent to explore..." to isolate file reads from your main context.';
      const lines = top.map((e) => `**${e.project}**: ${e.chainLength} consecutive reads across ${e.filesExplored} files`);
      const worst = top[0]!;
      return `Longest exploration chains:\n${lines.map((l) => `  - ${l}`).join('\n')}\nIn **${worst.project}**, those ${worst.chainLength} file reads all landed in your main context. Next time, ask Claude to use a subagent to explore [module] and summarize the key files — the reads happen in an isolated session and only the summary comes back.`;
    })(),
    effort: 'quick',
  };
}
