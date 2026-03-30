/**
 * Session Timing Detector
 *
 * Analyzes when sessions occur and identifies timing patterns:
 * - Rate limit proximity (high token usage in short windows)
 * - Inefficient timing (late-night sessions)
 * - Peak usage times
 */

import type { SessionData, DetectorResult, Remediation } from '../types.js';

interface SessionTimingEvidence {
  totalSessions: number;
  peakHours: number[];
  lateNightSessions: number;
  highIntensityWindows: number;
  avgSessionLength: number;
  recommendations: string[];
}

interface TimeWindow {
  hour: number;
  sessions: number;
  tokens: number;
}

export function detectSessionTiming(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  // Group sessions by hour
  const hourlyData = new Map<number, TimeWindow>();

  for (let i = 0; i < 24; i++) {
    hourlyData.set(i, { hour: i, sessions: 0, tokens: 0 });
  }

  let lateNightSessions = 0;
  let totalSessionLength = 0;

  for (const session of sessions) {
    const startTime = new Date(session.startedAt);
    const hour = startTime.getUTCHours();

    const window = hourlyData.get(hour);
    if (window) {
      window.sessions++;
      window.tokens += session.totalInputTokens + session.totalOutputTokens;
    }

    // Late night: 10 PM - 6 AM
    if (hour >= 22 || hour < 6) {
      lateNightSessions++;
    }

    // Calculate session length
    if (session.endedAt && session.startedAt) {
      const length = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
      totalSessionLength += length;
    }
  }

  // Find peak hours (top 3 by tokens)
  const sortedHours = [...hourlyData.values()].sort((a, b) => b.tokens - a.tokens);
  const peakHours = sortedHours.slice(0, 3).map((h) => h.hour);

  // Find high-intensity windows (hours with >20% of sessions)
  const highIntensityWindows = [...hourlyData.values()].filter(
    (w) => w.sessions > sessions.length * 0.2
  ).length;

  // Calculate average session length in minutes
  const avgSessionLength = Math.round((totalSessionLength / sessions.length) / 60000);

  // Generate recommendations
  const recommendations: string[] = [];

  if (lateNightSessions > sessions.length * 0.2) {
    recommendations.push('Consider scheduling complex tasks during daytime for better focus');
  }

  if (highIntensityWindows > 3) {
    recommendations.push('High usage clustering detected - spread out sessions to avoid rate limits');
  }

  const peakHourStr = peakHours.map((h) => `${h}:00`).join(', ');
  recommendations.push(`Peak usage hours: ${peakHourStr} UTC`);

  // Calculate savings potential (mainly from avoiding rate limits)
  const totalTokens = sessions.reduce(
    (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens,
    0
  );
  const savingsPercent = highIntensityWindows > 3 ? 5 : lateNightSessions > sessions.length * 0.3 ? 3 : 0;

  if (savingsPercent === 0) return null;

  const severity: 'high' | 'medium' | 'low' =
    savingsPercent >= 5 ? 'medium' : 'low';

  const confidence = 0.6; // Lower confidence for timing-based insights

  const evidence: SessionTimingEvidence = {
    totalSessions: sessions.length,
    peakHours,
    lateNightSessions,
    highIntensityWindows,
    avgSessionLength,
    recommendations,
  };

  const remediation = buildSessionTimingRemediation(evidence, sessions.length);

  const peakStr = evidence.peakHours.map((h) => `${h}:00 UTC`).join(', ');
  const sessionBreakdown = `**Timing summary across all projects**\n  - Peak hours: ${peakStr}\n  - Late-night sessions (10PM–6AM): **${lateNightSessions}** of ${sessions.length}\n  - High-intensity windows: **${evidence.highIntensityWindows}** hours with >20% of sessions\n  - Average session length: **${evidence.avgSessionLength} min**`;

  return {
    detector: 'session-timing',
    title: 'Session Timing',
    severity,
    savingsPercent,
    savingsTokens: Math.round(totalTokens * (savingsPercent / 100)),
    confidence,
    evidence,
    remediation,
    sessionBreakdown,
  };
}

function buildSessionTimingRemediation(evidence: SessionTimingEvidence, totalSessions: number): Remediation {
  const peakHourStr = evidence.peakHours.map((h) => `${h}:00`).join(', ');
  const lateNightRate = Math.round((evidence.lateNightSessions / totalSessions) * 100);

  return {
    problem: `Your session timing patterns show potential inefficiencies. ${evidence.lateNightSessions > 0 ? `${evidence.lateNightSessions} sessions (${lateNightRate}%) were started between 10 PM and 6 AM, when cognitive load and error rates are higher. ` : ''}${evidence.highIntensityWindows > 3 ? `You have ${evidence.highIntensityWindows} hours with concentrated usage, which increases your risk of hitting API rate limits. ` : ''}Peak usage hours: ${peakHourStr} UTC. Average session length: ${evidence.avgSessionLength} minutes.`,

    whyItMatters: `Timing affects both cost and effectiveness. Late-night sessions tend to produce vaguer prompts and more back-and-forth corrections — each adding tokens to context. Concentrated usage windows increase rate-limit risk, which forces wait times and context reloads that waste tokens. There is a compounding relationship between session length and token cost: every turn in a session sends the full conversation history as input. A session that runs 40 turns may spend more tokens re-sending old context than on new work. When context grows past ~100K tokens, each additional turn costs significantly more input tokens, and the model's attention degrades — leading to more corrections and even more turns. This feedback loop is why a 60-minute session often costs 3-4x more per useful output than a 20-minute session. ${evidence.avgSessionLength > 60 ? `Your average session length of ${evidence.avgSessionLength} minutes is well into the zone where context growth dominates token spend — splitting these into shorter, focused sessions would cut costs dramatically.` : ''}`,

    steps: [
      ...(evidence.lateNightSessions > totalSessions * 0.2 ? [{
        action: 'Schedule complex tasks during peak focus hours',
        howTo: 'Save complex refactors, architectural decisions, and multi-file changes for your most alert hours. Use late-night sessions only for simple, well-defined tasks like quick fixes or documentation updates. If you must work late, write detailed prompts to compensate for reduced cognitive precision.',
        impact: 'Better prompts during alert hours reduce clarification rounds and wasted exploration turns.',
      }] : []),
      ...(evidence.highIntensityWindows > 3 ? [{
        action: 'Spread sessions across hours to avoid rate limits',
        howTo: 'If you have batch work, stagger it across time windows instead of running many sessions in the same hour. When a session feels heavy with accumulated context, compact your context window (type /compact) to strip away stale history and keep per-turn token usage lean — this is especially effective during high-intensity windows to stay under rate limits.',
        impact: 'Reduces rate-limit wait times. Rate limit pauses can force context reloads that waste 5,000-20,000 tokens per incident.',
      }] : []),
      {
        action: 'Keep sessions under 30 minutes when possible',
        howTo: 'Set a mental timer. When a session runs long, ask yourself: "Am I still on the original task, or has this drifted?" If it\'s drifted, start a fresh session. Long sessions accumulate context debt that makes every turn progressively more expensive.',
        impact: `${evidence.avgSessionLength > 30 ? `Reducing your average session from ${evidence.avgSessionLength} to ~25 minutes would prevent most context snowball issues.` : 'Keeps sessions focused and context lean.'}`,
      },
    ],

    examples: [
      {
        label: 'Session timing',
        before: '11 PM: "refactor the auth module" → vague prompt → 15 clarification turns → context snowball → frustrated at 1 AM',
        after: '10 AM: "Refactor src/auth/jwt.ts to separate token generation from validation. Keep the public API unchanged." → clean implementation in 5 turns',
      },
      {
        label: 'Rate limit avoidance',
        before: '5 sessions started in the same hour → rate limited on session 4 → context lost → re-read 20 files → 50K wasted tokens',
        after: '2 sessions per hour → no rate limits → smooth workflow → tokens spent on actual work',
      },
    ],

    quickWin: evidence.lateNightSessions > totalSessions * 0.2
      ? 'For your next late-night session, spend 30 extra seconds writing a detailed first prompt with specific file paths. This one habit compensates for reduced focus.'
      : 'Start your next intensive work block 15 minutes earlier to give yourself buffer time before rate limits could kick in.',
    specificQuickWin: (() => {
      const lateRate = Math.round((evidence.lateNightSessions / totalSessions) * 100);
      const peakStr = evidence.peakHours.map((h) => `${h}:00`).join(', ');
      if (evidence.lateNightSessions > totalSessions * 0.2) {
        return `${evidence.lateNightSessions} of your ${totalSessions} sessions (${lateRate}%) ran between 10 PM–6 AM. Peak hours: ${peakStr} UTC. For late-night sessions, front-load context in your first prompt — specific file paths and function names compensate for reduced precision.`;
      }
      return `Peak usage at ${peakStr} UTC with ${evidence.highIntensityWindows} high-intensity hour(s). Spread sessions across hours to avoid rate-limit pauses, which force context reloads.`;
    })(),
    effort: 'quick',
  };
}
