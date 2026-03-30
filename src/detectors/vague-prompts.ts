/**
 * Vague Prompts Detector
 *
 * Identifies prompts that are too vague and require clarification:
 * - Short prompts (<10 words)
 * - Missing specific nouns (file names, function names)
 * - Ambiguous verbs ("fix", "improve", "optimize")
 * - Sessions that end without clear outcome
 */

import type { SessionData, DetectorResult, Remediation } from '../types.js';

interface VaguePromptsEvidence {
  sessionsWithVaguePrompts: number;
  totalSessions: number;
  vagueRate: number;
  clarificationRounds: number;
  avgPromptLength: number;
  vagueVerbs: Record<string, number>;
  examples: Array<{
    slug: string;
    project: string;
    prompt: string;
    wordCount: number;
    vagueReason: string;
  }>;
  positiveExamples: Array<{
    slug: string;
    project: string;
    prompt: string;
    wordCount: number;
  }>;
}

const VAGUE_VERBS = [
  'fix', 'improve', 'optimize', 'refactor', 'clean', 'update',
  'change', 'modify', 'enhance', 'better', 'best', 'good',
];

const SPECIFICITY_PATTERNS = [
  /\.(ts|js|py|java|go|rs|tsx|jsx)$/, // File extensions
  /[A-Z][a-z]+[A-Z]/, // CamelCase (function/class names)
  /`[^`]+`/, // Code in backticks
  /['"][^'"]+['"]/, // Quoted strings
  /\b(class|function|method|variable|interface|type)\s+\w+/, // Named entities
];

function isVaguePrompt(content: string): { isVague: boolean; reason: string } {
  const words = content.trim().split(/\s+/);
  const wordCount = words.length;

  // Check for short prompts
  if (wordCount < 5) {
    return { isVague: true, reason: 'Very short prompt (<5 words)' };
  }

  if (wordCount < 10) {
    // Check if it has any specificity
    const hasSpecificity = SPECIFICITY_PATTERNS.some((p) => p.test(content));
    if (!hasSpecificity) {
      return { isVague: true, reason: 'Short prompt without specifics' };
    }
  }

  // Check for vague verbs
  const lowerContent = content.toLowerCase();
  const usedVagueVerbs = VAGUE_VERBS.filter((v) => lowerContent.includes(v));

  if (usedVagueVerbs.length > 0 && wordCount < 20) {
    const hasSpecificity = SPECIFICITY_PATTERNS.some((p) => p.test(content));
    if (!hasSpecificity) {
      return { isVague: true, reason: `Vague verb(s): ${usedVagueVerbs.join(', ')}` };
    }
  }

  return { isVague: false, reason: '' };
}

function estimateClarificationRounds(session: SessionData): number {
  // Count user messages that are likely clarifications (short, after initial prompt)
  let rounds = 0;
  const userMessages = session.messages.filter((m) => m.role === 'user');

  for (let i = 1; i < userMessages.length; i++) {
    const msg = userMessages[i];
    if (!msg) continue;
    const wordCount = msg.content.split(/\s+/).length;

    // Short follow-up messages often indicate clarification
    if (wordCount < 15) {
      rounds++;
    }
  }

  return rounds;
}

export function detectVaguePrompts(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  const vagueSessions: Array<{
    session: SessionData;
    prompt: string;
    wordCount: number;
    reason: string;
  }> = [];

  const positiveExamples: VaguePromptsEvidence['positiveExamples'] = [];
  const vagueVerbs: Record<string, number> = {};
  let totalPromptLength = 0;
  let totalClarificationRounds = 0;

  for (const session of sessions) {
    const userMessages = session.messages.filter((m) => m.role === 'user');
    if (userMessages.length === 0) continue;

    const firstPrompt = userMessages[0]?.content ?? '';
    const wordCount = firstPrompt.split(/\s+/).length;
    totalPromptLength += wordCount;

    const { isVague, reason } = isVaguePrompt(firstPrompt);

    if (isVague) {
      vagueSessions.push({
        session,
        prompt: firstPrompt.slice(0, 200),
        wordCount,
        reason,
      });

      // Track vague verbs
      const lowerPrompt = firstPrompt.toLowerCase();
      for (const verb of VAGUE_VERBS) {
        if (lowerPrompt.includes(verb)) {
          vagueVerbs[verb] = (vagueVerbs[verb] ?? 0) + 1;
        }
      }

      totalClarificationRounds += estimateClarificationRounds(session);
    } else if (positiveExamples.length < 5 && wordCount > 10) {
      // Collect positive examples
      positiveExamples.push({
        slug: session.slug,
        project: session.project,
        prompt: firstPrompt.slice(0, 100),
        wordCount,
      });
    }
  }

  if (vagueSessions.length === 0) return null;

  const vagueRate = (vagueSessions.length / sessions.length) * 100;
  const avgPromptLength = Math.round(totalPromptLength / sessions.length);

  // Get examples
  const examples = vagueSessions.slice(0, 5).map((v) => ({
    slug: v.session.slug,
    project: v.session.project,
    prompt: v.prompt,
    wordCount: v.wordCount,
    vagueReason: v.reason,
  }));

  // Estimate savings: vague prompts cause both clarification rounds AND
  // speculative exploration (file reads that wouldn't happen with a specific prompt).
  // Compare average tokens per vague session vs non-vague to capture both effects.
  const vagueTokens = vagueSessions.reduce(
    (sum, v) => sum + v.session.totalInputTokens + v.session.totalOutputTokens, 0
  );
  const nonVagueSessions = sessions.filter(
    (s) => !vagueSessions.some((v) => v.session.id === s.id)
  );

  let wastedTokens: number;
  if (nonVagueSessions.length > 0) {
    const avgVague = vagueTokens / vagueSessions.length;
    const avgNonVague = nonVagueSessions.reduce(
      (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens, 0
    ) / nonVagueSessions.length;
    // Attribute 30% of the difference to vagueness (not all overhead is from vague prompts)
    const overheadPerSession = Math.max(0, avgVague - avgNonVague) * 0.3;
    wastedTokens = Math.round(overheadPerSession * vagueSessions.length);
  } else {
    // All sessions are vague — fall back to clarification-based estimate
    const avgClarificationsPerVague = totalClarificationRounds / vagueSessions.length;
    wastedTokens = Math.round(vagueSessions.length * avgClarificationsPerVague * 750);
  }

  const totalTokens = sessions.reduce(
    (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens,
    0
  );
  const savingsPercent = totalTokens > 0 ? Math.min(10, Math.round((wastedTokens / totalTokens) * 100)) : 0;

  const severity: 'high' | 'medium' | 'low' =
    vagueRate > 40 ? 'high' : vagueRate > 20 ? 'medium' : 'low';

  const confidence = Math.min(0.85, 0.5 + vagueSessions.length * 0.02);

  const evidence: VaguePromptsEvidence = {
    sessionsWithVaguePrompts: vagueSessions.length,
    totalSessions: sessions.length,
    vagueRate: Math.round(vagueRate),
    clarificationRounds: totalClarificationRounds,
    avgPromptLength,
    vagueVerbs,
    examples,
    positiveExamples: positiveExamples.slice(0, 3),
  };

  const remediation = buildVaguePromptsRemediation(evidence);

  // Pre-render session breakdown
  const sessionBreakdown = vagueSessions.slice(0, 6).reduce((acc, v) => {
    const proj = v.session.project;
    if (!acc[proj]) acc[proj] = [];
    acc[proj]!.push(`  - "${v.prompt.slice(0, 70)}${v.prompt.length > 70 ? '…' : ''}" (${v.reason})`);
    return acc;
  }, {} as Record<string, string[]>);

  const sessionBreakdownStr = Object.entries(sessionBreakdown)
    .map(([project, rows]) => `**${project}**\n${rows.join('\n')}`)
    .join('\n\n');

  return {
    detector: 'vague-prompts',
    title: 'Vague Prompts',
    severity,
    savingsPercent,
    savingsTokens: wastedTokens,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdownStr || '_No specific sessions to call out._',
  };
}

function buildVaguePromptsRemediation(evidence: VaguePromptsEvidence): Remediation {
  const topVerbs = Object.entries(evidence.vagueVerbs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([verb]) => verb);
  const vagueExample = evidence.examples[0];
  const goodExample = evidence.positiveExamples[0];

  // Group by project
  const byProject = new Map<string, string[]>();
  for (const ex of evidence.examples) {
    const existing = byProject.get(ex.project) ?? [];
    existing.push(`"${ex.prompt.slice(0, 50)}${ex.prompt.length > 50 ? '…' : ''}"`);
    byProject.set(ex.project, existing);
  }
  const projectLines = [...byProject.entries()]
    .map(([proj, prompts]) => `**${proj}**: ${prompts.slice(0, 2).join(', ')}`)
    .join('; ');

  const avgClarifications = Math.round(evidence.clarificationRounds / Math.max(evidence.sessionsWithVaguePrompts, 1));

  return {
    problem: `${evidence.sessionsWithVaguePrompts} sessions (${evidence.vagueRate}% of total) started with prompts too vague for Claude to act on without exploration or clarification. ${topVerbs.length > 0 ? `Most frequent vague verbs: "${topVerbs.join('", "')}". ` : ''}By project: ${projectLines || 'multiple projects'}. Each vague prompt forces Claude to ask questions or explore speculatively — adding turns and context before any real work begins.`,

    whyItMatters: `${vagueExample ? `Example from **${vagueExample.project}**: "${vagueExample.prompt.slice(0, 80)}${vagueExample.prompt.length > 80 ? '…' : ''}" — flagged because: ${vagueExample.vagueReason}. ` : ''}Vague prompts trigger a discovery loop: Claude guesses → reads files to check → asks for clarification → you answer → Claude re-reads. Your vague sessions averaged ${avgClarifications} clarification round${avgClarifications !== 1 ? 's' : ''} each. Worse, files Claude read while guessing stay in context permanently, even when they turned out irrelevant. ${goodExample ? `Contrast with this effective prompt from **${goodExample.project}**: "${goodExample.prompt.slice(0, 100)}" — ${goodExample.wordCount} words, no exploration needed.` : ''}`,

    steps: [
      {
        action: 'Include file paths and function names in your prompt',
        howTo: 'Instead of "fix the login bug," write "Fix the JWT validation bug in src/auth/jwt.ts — the validateToken() function throws on expired tokens instead of returning false." The more identifiers you include, the fewer exploration turns Claude needs.',
        impact: 'Eliminates 1-3 exploration turns per session. Each saved turn prevents ~2,000-5,000 tokens of context bloat.',
      },
      {
        action: 'Specify the desired outcome, not just the action',
        howTo: 'Instead of "improve the error handling," write "Add try-catch to the database calls in src/db/queries.ts so that connection failures return a 503 status instead of crashing the server." Define what "done" looks like.',
        impact: 'Removes ambiguity about scope. Claude can implement in one pass instead of iterating on what "improve" means.',
      },
      {
        action: 'Provide constraints and context upfront',
        howTo: 'Add relevant constraints: "Don\'t modify the public API," "Keep backward compatibility with v2 clients," "The tests in auth.test.ts should still pass." This prevents Claude from making assumptions that require correction later.',
        impact: 'Reduces back-and-forth corrections. Each correction round costs ~1,000 tokens and often triggers re-reads of files.',
      },
    ],

    examples: [
      {
        label: 'Bug fix prompt',
        before: '"Fix the login bug"',
        after: '"Fix the login bug in src/auth/login.ts — users with special characters in passwords get a 400 error because the password isn\'t URL-encoded before the API call on line 47"',
      },
      {
        label: 'Feature request prompt',
        before: '"Add caching"',
        after: '"Add Redis caching to the getUser() function in src/services/user.ts with a 5-minute TTL. Use the existing Redis client from src/lib/redis.ts. Cache key format: user:{id}"',
      },
      ...(goodExample ? [{
        label: 'One of your effective prompts',
        before: vagueExample?.prompt.slice(0, 100) ?? '"fix it"',
        after: goodExample.prompt.slice(0, 150),
      }] : []),
    ],

    quickWin: 'Before your next prompt, add one specific file path and one function/component name. Just these two additions cut exploration time significantly.',
    specificQuickWin: (() => {
      const top = evidence.examples.slice(0, 2);
      if (top.length === 0) return 'Add a specific file path and function name to your next prompt.';
      const lines = top.map((e) => `**${e.project}**: "${e.prompt.slice(0, 60)}${e.prompt.length > 60 ? '...' : ''}" — ${e.vagueReason}`);
      return `Vague prompts detected:\n${lines.map((l) => `  - ${l}`).join('\n')}\nFix: add a file path and function name. E.g., "${top[0]!.prompt.slice(0, 40)}..." → "[same intent] in \`src/[module]/[file].ts\`, specifically the \`[functionName]\` function".`;
    })(),
    effort: 'quick',
  };
}
