/**
 * Bash Output Bloat Detector
 *
 * Detects inefficient bash commands that produce excessive output:
 * - Excessive flags: ls -R, find without limits
 * - Verbose output: commands with unnecessary verbosity
 * - Missing pagination: no | head, | tail, | less
 * - Full file dumps: cat on large files
 * - Usage checks: --help and --version commands
 */

import type { SessionData, DetectorResult, Remediation } from '../types.js';

interface BashOutputBloatEvidence {
  sessionsWithBloat: number;
  totalSessions: number;
  bloatRate: number;
  categories: {
    excessiveFlags: number;
    missingPagination: number;
    fullFileDumps: number;
    usageChecks: number;
  };
  examples: Array<{
    slug: string;
    project: string;
    command: string;
    category: string;
  }>;
}

// Patterns that indicate bloat
const BLOAT_PATTERNS = {
  excessiveFlags: [
    { pattern: /ls\s+-R|--recursive/, reason: 'Recursive listing' },
    { pattern: /find\s+.*(?!\|)/, reason: 'Find without limits' },
    { pattern: /git\s+log(?!\s+-(n|\d))/, reason: 'Git log without limit' },
    { pattern: /--verbose|-v{2,}/, reason: 'Verbose output' },
  ],
  missingPagination: [
    { pattern: /^(cat|head|tail)\s+\S+\.(log|txt|json|xml|csv)$/m, reason: 'Reading large file directly' },
    { pattern: /npm\s+(list|ls)(?!\s+--depth)/, reason: 'NPM list without depth' },
    { pattern: /pip\s+list/, reason: 'Pip list without format' },
  ],
  fullFileDumps: [
    { pattern: /^cat\s+\S+\.(md|txt|log)$/m, reason: 'Cat on text file' },
    { pattern: /echo\s+["'].*["']\s*>/, reason: 'Echo to file (use Write tool)' },
  ],
  usageChecks: [
    { pattern: /--help$/, reason: 'Help command' },
    { pattern: /--version$/, reason: 'Version check' },
    { pattern: /-h$/, reason: 'Help flag' },
  ],
};

interface BloatMatch {
  command: string;
  category: string;
  reason: string;
}

function detectBloatPatterns(command: string): BloatMatch[] {
  const matches: BloatMatch[] = [];

  for (const [category, patterns] of Object.entries(BLOAT_PATTERNS)) {
    for (const { pattern, reason } of patterns) {
      if (pattern.test(command)) {
        matches.push({ command, category, reason });
      }
    }
  }

  return matches;
}

export function detectBashOutputBloat(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  const categoryCounts = {
    excessiveFlags: 0,
    missingPagination: 0,
    fullFileDumps: 0,
    usageChecks: 0,
  };

  const allExamples: Array<{
    slug: string;
    project: string;
    command: string;
    category: string;
  }> = [];

  let sessionsWithBloat = 0;

  for (const session of sessions) {
    let sessionBloat = false;

    for (const toolUse of session.toolUses) {
      if (toolUse.name !== 'Bash') continue;

      const command = (toolUse.input.command ?? toolUse.input.cmd) as string;
      if (!command) continue;

      const matches = detectBloatPatterns(command);

      if (matches.length > 0) {
        sessionBloat = true;

        for (const match of matches) {
          categoryCounts[match.category as keyof typeof categoryCounts]++;

          if (allExamples.length < 10) {
            allExamples.push({
              slug: session.slug,
              project: session.project,
              command: command.slice(0, 100),
              category: match.category,
            });
          }
        }
      }
    }

    if (sessionBloat) {
      sessionsWithBloat++;
    }
  }

  const totalBloats = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  if (totalBloats === 0) return null;

  const bloatRate = (sessionsWithBloat / sessions.length) * 100;

  // Estimate wasted tokens (rough: each bloat adds ~500-2000 tokens)
  const avgWastePerBloat = 1000;
  const wastedTokens = totalBloats * avgWastePerBloat;

  const totalTokens = sessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );
  const savingsPercent = totalTokens > 0 ? Math.round((wastedTokens / totalTokens) * 100) : 0;

  const severity: 'high' | 'medium' | 'low' =
    savingsPercent > 5 ? 'high' : savingsPercent > 2 ? 'medium' : 'low';

  const confidence = Math.min(0.8, 0.4 + sessionsWithBloat * 0.015);

  const evidence: BashOutputBloatEvidence = {
    sessionsWithBloat,
    totalSessions: sessions.length,
    bloatRate: Math.round(bloatRate),
    categories: categoryCounts,
    examples: allExamples.slice(0, 5),
  };

  const remediation = buildBashBloatRemediation(evidence, categoryCounts);

  // Pre-render session breakdown
  const byProject = new Map<string, typeof allExamples>();
  for (const ex of allExamples.slice(0, 10)) {
    const list = byProject.get(ex.project) ?? [];
    list.push(ex);
    byProject.set(ex.project, list);
  }
  const sessionBreakdown = [...byProject.entries()]
    .map(([project, exs]) => {
      const rows = exs.map((ex) =>
        `  - \`${ex.command.slice(0, 80)}${ex.command.length > 80 ? '…' : ''}\` (${ex.category})`
      ).join('\n');
      return `**${project}**\n${rows}`;
    }).join('\n\n');

  return {
    detector: 'bash-output-bloat',
    title: 'Bash Output Bloat',
    severity,
    savingsPercent,
    savingsTokens: wastedTokens,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdown || '_No specific sessions to call out._',
  };
}

function buildBashBloatRemediation(evidence: BashOutputBloatEvidence, categories: typeof evidence.categories): Remediation {
  const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  const topCategoryName = topCategory ? topCategory[0].replace(/([A-Z])/g, ' $1').toLowerCase().trim() : 'unknown';
  const topCategoryCount = topCategory ? topCategory[1] : 0;

  return {
    problem: `${evidence.sessionsWithBloat} sessions (${evidence.bloatRate}% of total) contained bash commands that produced unnecessarily large output. The most common category was "${topCategoryName}" with ${topCategoryCount} occurrences. When a bash command dumps thousands of lines into the conversation, Claude has to process all of it — even if only a few lines are relevant. This bloats the context and slows down responses.`,

    whyItMatters: `Bash output goes directly into the context window as a tool result — and it stays there permanently for the entire session. Every line a command prints becomes part of the conversation that Claude must process on every subsequent turn. A single \`git log\` without \`-n\` can dump thousands of commits (10,000+ tokens) that cannot be removed. A \`find\` without limits can return thousands of files. Unlike file reads (which are somewhat bounded), bash output has no guardrails — one bad command can inject more tokens than 20 file reads combined, and those tokens persist until the session ends. ${categories.fullFileDumps > 0 ? `You had ${categories.fullFileDumps} instances of using \`cat\` on files instead of the Read tool, which doesn't support targeted line ranges.` : ''}`,

    steps: [
      ...(categories.excessiveFlags > 0 ? [{
        action: 'Always limit output-heavy commands',
        howTo: 'Add limits to commands: `git log -n 20` instead of `git log`, `find . -name "*.ts" | head -20` instead of unbounded find, `ls` instead of `ls -R`. Ask Claude to "show me the last 10 commits" rather than "show me the git log."',
        impact: `Prevents ${categories.excessiveFlags} instances of excessive output. A bounded \`git log -n 10\` is ~500 tokens vs unbounded at 10,000+.`,
      }] : []),
      ...(categories.missingPagination > 0 ? [{
        action: 'Pipe large outputs through head/tail/grep',
        howTo: 'When running commands that might produce large output, pipe through filters: `npm list --depth=0` instead of `npm list`, `docker ps --format "table {{.Names}}\\t{{.Status}}"` instead of `docker ps -a`. Tell Claude to "show me only the relevant lines."',
        impact: `Prevents ${categories.missingPagination} instances of unpaginated output from bloating context.`,
      }] : []),
      ...(categories.fullFileDumps > 0 ? [{
        action: 'Use the Read tool instead of cat/head/tail',
        howTo: 'Claude has a built-in Read tool that supports line ranges and is designed for file reading. Instead of `cat file.ts`, Claude should use `Read file.ts`. You can help by saying "read the file" instead of "cat the file" in your prompts.',
        impact: `The Read tool is more token-efficient and supports targeted ranges. Eliminates ${categories.fullFileDumps} cat/echo commands.`,
      }] : []),
      {
        action: 'Be specific about what output you need',
        howTo: 'Instead of "run the tests," say "run the tests and show me only failures." Instead of "check npm dependencies," say "show me outdated dependencies with `npm outdated`." The more specific your request, the more Claude can filter the output.',
        impact: 'Reduces average bash output size by 50-80% by focusing on relevant information.',
      },
      {
        action: 'Filter command output before it enters the conversation',
        howTo: 'Any output from a bash command is permanently added to the context window for the rest of the session — it cannot be removed or summarized later. Structure your commands so only the relevant lines are produced in the first place. For example, instead of dumping a 50K-line log file and hoping to find errors, use `grep ERROR server.log | tail -20` so only the 20 most recent error lines ever enter the context. The key principle: whatever the command outputs, Claude has to carry for the entire session.',
        impact: 'Filtering at the command level (grep, awk, sed, head, tail) prevents thousands of irrelevant tokens from entering the context window permanently. A single `grep` on a large file can reduce a 10,000-token result to under 200 tokens.',
      },
    ],

    examples: [
      {
        label: 'Git log',
        before: '`git log` → 500+ commits dumped into context (15,000+ tokens)',
        after: '`git log -n 10 --oneline` → 10 lines (200 tokens)',
      },
      {
        label: 'File reading',
        before: '`cat src/big-module.ts` → entire 500-line file as bash output (3,000 tokens)',
        after: 'Read tool with line range → only relevant section (500 tokens)',
      },
      {
        label: 'Dependency listing',
        before: '`npm list` → full dependency tree with 200+ packages (5,000 tokens)',
        after: '`npm list --depth=0` → only top-level packages (500 tokens)',
      },
    ],

    quickWin: 'When asking Claude to run a command, add "show me only the first 20 lines" or "only show errors" to your prompt. This teaches Claude to pipe through `head` or `grep` automatically.',
    specificQuickWin: (() => {
      const top = evidence.examples.slice(0, 3);
      if (top.length === 0) return 'Add output limits to commands (e.g., `git log -n 10`, `find . | head -20`).';
      const lines = top.map((e) => `\`${e.command.slice(0, 60)}\` in **${e.project}**`);
      return `Bloaty commands found:\n${lines.map((l) => `  - ${l}`).join('\n')}\nAdd limits: \`git log\` → \`git log -n 10 --oneline\`, unbounded \`find\` → \`find . -name "*.ts" | head -20\`.`;
    })(),
    effort: 'quick',
  };
}
