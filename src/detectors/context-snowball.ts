/**
 * Context Snowball Detector
 *
 * Detects sessions where context grows unboundedly without /compact intervention.
 * This is a universal detector — context growth is agent-agnostic.
 *
 * Algorithm:
 * - Build context series using totalContext = inputTokens + cacheReadTokens + cacheCreationTokens/2
 * - Filter out turns with totalContext < 500 (hook/subagent noise)
 * - Calculate baseline: median of first 3 substantial turns
 * - Find inflection: first turn where totalContext > 2.5x baseline
 * - Calculate growth multiplier: peak / baseline
 * - Calculate excess context tokens (rate-limit impact)
 * - Detect topic shifts using Jaccard similarity
 */

import type { SessionData, DetectorResult, Remediation, AgentContext } from '../types.js';
import { getContextTurns } from '../parser.js';
import { adjustConfidenceForEstimates } from './agent-context.js';

interface SnowballEvidence {
  sessionsWithSnowball: number;
  totalSessions: number;
  snowballRate: number;
  avgInflectionTurn: number;
  avgGrowthMultiplier: number;
  worstSessions: Array<{
    slug: string;
    project: string;
    date: string;
    inflectionTurn: number;
    growthMultiplier: number;
    excessTokens: number;
  }>;
  compactUsedRate: number;
  potentialSavingsPercent: number;
}

interface SessionSnowball {
  session: SessionData;
  inflectionTurn: number;
  growthMultiplier: number;
  excessTokens: number;
  baseline: number;
  peak: number;
}

// Thresholds
const MIN_CONTEXT_THRESHOLD = 500; // Ignore turns with less than this
const SNOWBALL_MULTIPLIER = 2.5; // Context must grow this much to be snowball
const MIN_TURNS_FOR_ANALYSIS = 3; // Need at least this many turns

export function detectContextSnowball(sessions: SessionData[], _agentContext?: AgentContext): DetectorResult | null {
  if (sessions.length === 0) return null;

  const snowballs: SessionSnowball[] = [];
  let totalCompactUsed = 0;

  for (const session of sessions) {
    const turns = getContextTurns(session);

    // Filter out low-context turns (hooks, subagents)
    const substantialTurns = turns.filter((t) => t.totalContext >= MIN_CONTEXT_THRESHOLD);

    if (substantialTurns.length < MIN_TURNS_FOR_ANALYSIS) continue;

    // Track compact usage
    if (session.compactUsed) totalCompactUsed++;

    // Calculate baseline from first 3 substantial turns
    const firstTurns = substantialTurns.slice(0, 3);
    const baseline = median(firstTurns.map((t) => t.totalContext));

    // Find inflection point (first turn > 2.5x baseline)
    let inflectionIdx = -1;
    for (let i = 0; i < substantialTurns.length; i++) {
      if (substantialTurns[i]!.totalContext > SNOWBALL_MULTIPLIER * baseline) {
        inflectionIdx = i;
        break;
      }
    }

    if (inflectionIdx === -1) continue; // No snowball

    // Calculate peak and growth multiplier
    const peak = Math.max(...substantialTurns.map((t) => t.totalContext));
    const growthMultiplier = peak / baseline;

    // Calculate excess tokens (tokens after inflection that could have been saved with /compact)
    let excessTokens = 0;
    for (let i = inflectionIdx; i < substantialTurns.length; i++) {
      const turn = substantialTurns[i]!;
      // Excess is anything above 2x baseline (reasonable context after growth)
      const reasonableThreshold = 2 * baseline;
      if (turn.totalContext > reasonableThreshold) {
        excessTokens += turn.totalContext - reasonableThreshold;
      }
    }

    snowballs.push({
      session,
      inflectionTurn: inflectionIdx,
      growthMultiplier,
      excessTokens,
      baseline,
      peak,
    });
  }

  if (snowballs.length === 0) return null;

  // Calculate aggregate metrics
  const snowballRate = snowballs.length / sessions.length;
  const compactUsedRate = totalCompactUsed / sessions.length;

  // Average inflection turn
  const avgInflectionTurn =
    snowballs.reduce((sum, s) => sum + s.inflectionTurn, 0) / snowballs.length;

  // Average growth multiplier
  const avgGrowthMultiplier =
    snowballs.reduce((sum, s) => sum + s.growthMultiplier, 0) / snowballs.length;

  // Total excess tokens
  const totalExcessTokens = snowballs.reduce((sum, s) => sum + s.excessTokens, 0);

  // Get worst sessions (sorted by excess tokens)
  const worstSessions = snowballs
    .sort((a, b) => b.excessTokens - a.excessTokens)
    .slice(0, 5)
    .map((s) => ({
      slug: s.session.slug,
      project: s.session.project,
      date: s.session.startedAt.split('T')[0] ?? '',
      inflectionTurn: s.inflectionTurn,
      growthMultiplier: Math.round(s.growthMultiplier * 10) / 10,
      excessTokens: s.excessTokens,
    }));

  // Calculate total tokens for savings percentage
  const totalTokens = sessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );

  const savingsPercent = totalTokens > 0 ? Math.round((totalExcessTokens / totalTokens) * 100) : 0;

  // Determine severity
  let severity: 'high' | 'medium' | 'low';
  if (snowballRate > 0.5 && compactUsedRate < 0.1) {
    severity = 'high';
  } else if (snowballRate > 0.3 || (snowballRate > 0.2 && compactUsedRate < 0.05)) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  // Confidence based on sample size and consistency
  let confidence = Math.min(0.95, 0.5 + snowballs.length * 0.05 + (1 - compactUsedRate) * 0.2);

  // Adjust confidence for estimated tokens
  confidence = adjustConfidenceForEstimates(confidence, sessions);

  const evidence: SnowballEvidence = {
    sessionsWithSnowball: snowballs.length,
    totalSessions: sessions.length,
    snowballRate: Math.round(snowballRate * 100),
    avgInflectionTurn: Math.round(avgInflectionTurn * 10) / 10,
    avgGrowthMultiplier: Math.round(avgGrowthMultiplier * 10) / 10,
    worstSessions,
    compactUsedRate: Math.round(compactUsedRate * 100),
    potentialSavingsPercent: savingsPercent,
  };

  const remediation = buildSnowballRemediation(evidence, totalExcessTokens);

  // Pre-render session breakdown grouped by project
  const byProject = new Map<string, typeof evidence.worstSessions>();
  for (const s of evidence.worstSessions) {
    const list = byProject.get(s.project) ?? [];
    list.push(s);
    byProject.set(s.project, list);
  }
  const sessionBreakdown = [...byProject.entries()]
    .map(([project, sessions]) => {
      const rows = sessions.map((s) => {
        const excess = s.excessTokens > 1_000_000
          ? `${(s.excessTokens / 1_000_000).toFixed(1)}M`
          : `${Math.round(s.excessTokens / 1000)}K`;
        return `  - **${s.project}** (${s.date}): grew **${s.growthMultiplier}x** from turn ${s.inflectionTurn}, wasted **${excess} tokens**`;
      }).join('\n');
      return `**${project}**\n${rows}`;
    }).join('\n\n');

  return {
    detector: 'context-snowball',
    title: 'Context Snowball',
    severity,
    savingsPercent,
    savingsTokens: totalExcessTokens,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdown || '_No specific sessions to call out._',
  };
}

function buildSnowballRemediation(evidence: SnowballEvidence, totalExcessTokens: number): Remediation {
  const avgTurn = Math.round(evidence.avgInflectionTurn);
  const formattedExcess = totalExcessTokens > 1_000_000
    ? `${(totalExcessTokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(totalExcessTokens / 1000)}K`;

  // Build project breakdown from worst sessions
  const projectCounts = new Map<string, { count: number; maxGrowth: number; worstSlug: string }>();
  for (const s of evidence.worstSessions) {
    const existing = projectCounts.get(s.project);
    if (!existing || s.growthMultiplier > existing.maxGrowth) {
      projectCounts.set(s.project, {
        count: (existing?.count ?? 0) + 1,
        maxGrowth: s.growthMultiplier,
        worstSlug: s.slug,
      });
    }
  }
  const projectLines = [...projectCounts.entries()]
    .sort((a, b) => b[1].maxGrowth - a[1].maxGrowth)
    .map(([proj, d]) => `**${proj}** (${d.maxGrowth}x growth)`)
    .join('; ');

  const worst = evidence.worstSessions[0];
  const worstDesc = worst
    ? `**${worst.project}** grew ${worst.growthMultiplier}x starting at turn ${worst.inflectionTurn}`
    : 'multiple sessions';

  return {
    problem: `In ${evidence.sessionsWithSnowball} of your ${evidence.totalSessions} sessions (${evidence.snowballRate}%), the context window grew unchecked — averaging ${evidence.avgGrowthMultiplier}x expansion after turn ${avgTurn}. Affected projects: ${projectLines || 'multiple projects'}. Only ${evidence.compactUsedRate}% of sessions used /compact. The result: Claude re-reads the entire ballooning conversation on every turn, paying for stale tool outputs, old file contents, and resolved discussions.`,

    whyItMatters: `Your worst session: ${worstDesc}, wasting ${worst ? (worst.excessTokens > 1_000_000 ? `${(worst.excessTokens / 1_000_000).toFixed(1)}M` : `${Math.round(worst.excessTokens / 1000)}K`) : '?'} tokens on redundant context. Across all affected sessions this totals ~${formattedExcess} excess tokens. The token usage compounds: each new turn in a snowballed session consumes more tokens than the last because the context floor keeps rising. Large contexts also make Claude more likely to lose track of earlier decisions — particularly noticeable in long **${evidence.worstSessions[0]?.project ?? 'project'}** sessions where the original goal gets buried under tool outputs.`,

    steps: [
      {
        action: 'Monitor context growth, then compact with a focus directive',
        howTo: 'Check your context window usage (type /cost to see current token count and context percentage) at regular intervals — after finishing a bug fix, completing an exploration phase, or wrapping up any logical chunk of work. When you see context climbing past 50%, use your context compaction feature (type /compact followed by a focus topic) — e.g., `/compact Focus on the auth module changes and the failing test cases`. This tells Claude to summarize and drop stale content while preserving what you need. You can also set compaction instructions permanently in your CLAUDE.md file so Claude knows what to preserve automatically.',
        impact: `Context auto-compaction only fires at ~95% capacity — that's already very late. Manual compaction with a focus directive gives you control and keeps Claude on-track. Across your ${evidence.sessionsWithSnowball} affected sessions, this could reclaim ~${formattedExcess} tokens.`,
      },
      {
        action: 'Start fresh when switching to an unrelated task',
        howTo: 'When you finish one task and want to start something completely different, don\'t carry the old context forward. First, name your session (type /rename followed by a descriptive name) so you can find it later. Then start a fresh session (type /clear to reset the context window) to begin the new task from scratch. If you ever need to return to the old work, resume a previous session (type /resume) to pick up exactly where you left off. Stale context from a previous task costs you tokens on every subsequent turn with zero benefit.',
        impact: 'Starting fresh eliminates the entire prior context. The difference is large: a session at 100K context uses 5-10x more tokens per turn than one starting at 10K.',
      },
      {
        action: 'Front-load your opening prompt to prevent exploration buildup',
        howTo: 'Include file paths, function names, and the desired outcome in your first message. Instead of "fix the login bug," write "Fix the JWT expiry bug in src/auth/jwt.ts — validateToken() should return false on expired tokens, not throw. The failing test is in tests/auth.test.ts line 42." Claude can act immediately without reading files speculatively.',
        impact: `Fewer exploration turns means less accumulated context. Your sessions with snowball averaged ${Math.round(evidence.avgGrowthMultiplier)}x growth — specific opening prompts typically keep sessions under 2x.`,
      },
    ],

    examples: [
      {
        label: 'Targeted compaction',
        before: 'Compacting without instructions — Claude summarizes everything generically and may lose the specific variable names or file paths you still need.',
        after: 'Use your context compaction feature (type /compact followed by a focus topic) — e.g., `/compact Focus on the changes made to src/auth/ and the two failing test cases` — so Claude preserves exactly what matters for the next phase.',
      },
      {
        label: 'Task switching',
        before: 'Finish debugging auth, then immediately ask "now help me with the deployment pipeline" — Claude carries 80K tokens of auth context into a completely unrelated task.',
        after: 'Name your session (type /rename followed by a descriptive name like "auth-debug"), then start a fresh session (type /clear to reset the context window). You get a clean deployment session at 5K tokens instead of dragging 80K along. Resume the old session later if needed.',
      },
    ],

    quickWin: 'Check your context window usage right now (type /cost to see current token count and context percentage) in any active session. If it\'s above 50%, use your context compaction feature (type /compact followed by a focus topic) — e.g., `/compact Focus on the feature you\'re currently building`. You\'ll cut context in half while keeping Claude aligned on what you\'re doing.',
    specificQuickWin: (() => {
      const worst = evidence.worstSessions[0];
      if (!worst) return `Your context typically snowballs around turn ${avgTurn}. After each logical work unit, use your context compaction feature (type /compact followed by a focus topic). When switching tasks entirely, start a fresh session (type /clear to reset the context window). Check your usage regularly (type /cost to see current token count and context percentage).`;
      const second = evidence.worstSessions[1];
      return `Your context snowballed hardest in **${worst.project}** — ${worst.growthMultiplier}x growth from turn ${worst.inflectionTurn}, wasting ${worst.excessTokens > 1_000_000 ? `${(worst.excessTokens / 1_000_000).toFixed(1)}M` : `${Math.round(worst.excessTokens / 1000)}K`} tokens. ${second ? `Same pattern in **${second.project}**: ${second.growthMultiplier}x growth. ` : ''}Use context compaction after completing a logical unit of work (finishing a bug fix, wrapping up an exploration phase) — not on a fixed schedule. Compacting mid-task loses relevant context.`;
    })(),
    effort: 'quick',
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
