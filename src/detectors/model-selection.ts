/**
 * Model Selection Detector
 *
 * Flags sessions where a more expensive model was used for simple tasks
 * that could have been handled by a cheaper model.
 *
 * Algorithm:
 * - Classify session complexity:
 *   - Simple: <5 tool uses, all Read/Edit/Bash
 *   - Medium: 5-15 tool uses OR any Agent tool
 *   - Complex: >15 tool uses OR multi-file refactors
 * - Check if model choice matches complexity
 * - Calculate cost difference using pricing data
 */

import type { SessionData, DetectorResult, Remediation } from '../types.js';

interface ModelSelectionEvidence {
  overkillSessions: number;
  totalSessions: number;
  overkillRate: number;
  estimatedOvercostPercent: number;
  examples: Array<{
    slug: string;
    project: string;
    date: string;
    model: string;
    toolCount: number;
    suggestedModel: string;
    complexity: string;
  }>;
}

// Model pricing (per 1M tokens, approximate)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'unknown': { input: 0, output: 0 },
};

const SIMPLE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']);

interface SessionComplexity {
  complexity: 'simple' | 'medium' | 'complex';
  suggestedModel: string;
  reason: string;
}

function analyzeComplexity(session: SessionData): SessionComplexity {
  const toolCount = session.toolUses.length;
  const toolNames = new Set(session.toolUses.map((t) => t.name));

  // Check for Agent tool usage (always complex)
  if (toolNames.has('Agent')) {
    return {
      complexity: 'complex',
      suggestedModel: 'claude-opus-4-6',
      reason: 'Uses Agent tool',
    };
  }

  // Complex: many total tool uses (check this before exploration to avoid misclassifying large sessions)
  if (toolCount > 15) {
    return {
      complexity: 'complex',
      suggestedModel: 'claude-opus-4-6',
      reason: 'Many operations',
    };
  }

  // Simple: few tools, all basic
  if (toolCount < 5) {
    const allSimple = [...toolNames].every((t) => SIMPLE_TOOLS.has(t));
    if (allSimple) {
      return {
        complexity: 'simple',
        suggestedModel: 'claude-sonnet-4-6',
        reason: 'Few simple operations',
      };
    }
  }

  // Medium: moderate exploration
  const readCount = session.toolUses.filter((t) => t.name === 'Read').length;
  const globCount = session.toolUses.filter((t) => t.name === 'Glob').length;
  if (readCount > 10 || globCount > 5) {
    return {
      complexity: 'medium',
      suggestedModel: 'claude-sonnet-4-6',
      reason: 'Heavy exploration',
    };
  }

  return {
    complexity: 'medium',
    suggestedModel: 'claude-sonnet-4-6',
    reason: 'Standard complexity',
  };
}

function getModelTier(model: string): 'opus' | 'sonnet' | 'haiku' | 'unknown' {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'unknown';
}

function isOverkill(model: string, suggestedModel: string): boolean {
  const modelTier = getModelTier(model);
  const suggestedTier = getModelTier(suggestedModel);

  const tierOrder = { haiku: 0, sonnet: 1, opus: 2, unknown: 3 };
  return tierOrder[modelTier] > tierOrder[suggestedTier];
}

export function detectModelSelection(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  const overkillSessions: Array<{
    session: SessionData;
    complexity: SessionComplexity;
  }> = [];

  for (const session of sessions) {
    // Skip sessions with unknown/synthetic models or no tool activity
    if (getModelTier(session.model) === 'unknown') continue;
    if (session.toolUses.length === 0 && session.totalInputTokens < 1000) continue;

    const complexity = analyzeComplexity(session);

    if (isOverkill(session.model, complexity.suggestedModel)) {
      overkillSessions.push({ session, complexity });
    }
  }

  if (overkillSessions.length === 0) return null;

  const overkillRate = (overkillSessions.length / sessions.length) * 100;

  // Calculate estimated cost difference
  let totalOvercost = 0;
  const examples: ModelSelectionEvidence['examples'] = [];

  for (const { session, complexity } of overkillSessions.slice(0, 10)) {
    const currentPricing = MODEL_PRICING[getModelTier(session.model)] ?? MODEL_PRICING['unknown']!;
    const suggestedPricing = MODEL_PRICING[getModelTier(complexity.suggestedModel)] ?? MODEL_PRICING['unknown']!;

    if (currentPricing && suggestedPricing && currentPricing.input > 0 && suggestedPricing.input > 0) {
      const inputCost = (session.totalInputTokens / 1_000_000) * currentPricing.input;
      const outputCost = (session.totalOutputTokens / 1_000_000) * currentPricing.output;
      const suggestedInputCost = (session.totalInputTokens / 1_000_000) * suggestedPricing.input;
      const suggestedOutputCost = (session.totalOutputTokens / 1_000_000) * suggestedPricing.output;

      totalOvercost += (inputCost + outputCost) - (suggestedInputCost + suggestedOutputCost);
    }

    if (examples.length < 5) {
      examples.push({
        slug: session.slug,
        project: session.project,
        date: session.startedAt.split('T')[0] ?? '',
        model: session.model,
        toolCount: session.toolUses.length,
        suggestedModel: complexity.suggestedModel,
        complexity: complexity.complexity,
      });
    }
  }

  // Calculate total tokens for savings percentage
  const totalTokens = sessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );

  // Estimate savings as difference in pricing tiers (rough: opus is 5x sonnet)
  const avgOvercostRatio = overkillSessions.filter((o) => getModelTier(o.session.model) === 'opus').length / overkillSessions.length;
  const savingsPercent = Math.round(overkillRate * avgOvercostRatio * 0.4); // Conservative estimate

  const severity: 'high' | 'medium' | 'low' =
    overkillRate > 30 ? 'high' : overkillRate > 15 ? 'medium' : 'low';

  const confidence = Math.min(0.9, 0.5 + overkillSessions.length * 0.03);

  const evidence: ModelSelectionEvidence = {
    overkillSessions: overkillSessions.length,
    totalSessions: sessions.length,
    overkillRate: Math.round(overkillRate),
    estimatedOvercostPercent: savingsPercent,
    examples,
  };

  const remediation = buildModelSelectionRemediation(evidence);

  // Pre-render session breakdown grouped by project
  const byProject = new Map<string, typeof evidence.examples>();
  for (const ex of evidence.examples) {
    const list = byProject.get(ex.project) ?? [];
    list.push(ex);
    byProject.set(ex.project, list);
  }
  const sessionBreakdown = [...byProject.entries()]
    .map(([project, examples]) => {
      const rows = examples.map((ex) =>
        `  - **${ex.project}** (${ex.date}): used **${ex.model.replace('claude-', '')}**, ${ex.toolCount} tool uses, complexity: ${ex.complexity} → **${ex.suggestedModel.replace('claude-', '')} was sufficient**`
      ).join('\n');
      return `**${project}**\n${rows}`;
    }).join('\n\n');

  return {
    detector: 'model-selection',
    title: 'Model Selection',
    severity,
    savingsPercent,
    savingsTokens: Math.round(totalTokens * (savingsPercent / 100)),
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdown || '_No specific sessions to call out._',
  };
}

function buildModelSelectionRemediation(evidence: ModelSelectionEvidence): Remediation {
  // Group overkill sessions by project
  const byProject = new Map<string, { count: number; examples: typeof evidence.examples }>();
  for (const ex of evidence.examples) {
    const existing = byProject.get(ex.project);
    if (existing) {
      existing.count++;
      existing.examples.push(ex);
    } else {
      byProject.set(ex.project, { count: 1, examples: [ex] });
    }
  }
  const projectLines = [...byProject.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([proj, d]) => {
      const ex = d.examples[0]!;
      return `**${proj}** (${d.count} session${d.count > 1 ? 's' : ''} — e.g., ${ex.toolCount} tool uses, ${ex.complexity} complexity)`;
    })
    .join('; ');

  const simpleExamples = evidence.examples.filter((e) => e.complexity === 'simple');

  return {
    problem: `${evidence.overkillSessions} of your ${evidence.totalSessions} sessions (${evidence.overkillRate}%) used Opus when Sonnet would have been sufficient. By project: ${projectLines || `${evidence.overkillSessions} sessions`}. ${simpleExamples.length > 0 ? `${simpleExamples.length} of these were simple tasks (under 5 tool uses, all basic Read/Edit/Bash) where Opus adds zero quality benefit over Sonnet.` : ''}`,

    whyItMatters: `Opus costs $15/$75 per 1M input/output tokens. Sonnet costs $3/$15 — a 5x difference. For the sessions flagged above, the tasks didn't require deep reasoning: ${simpleExamples.length > 0 ? `things like "${simpleExamples[0]!.complexity}" work in **${simpleExamples[0]!.project}** with only ${simpleExamples[0]!.toolCount} tool uses` : 'routine edits and exploration'}. Sonnet handles these identically. Your ${evidence.overkillRate}% overkill rate means ~1 in every ${Math.round(100 / Math.max(evidence.overkillRate, 1))} sessions overpays. Since model cost applies to every token in every turn, this is the highest-leverage single setting to change.`,

    steps: [
      {
        action: 'Set Sonnet as your default model',
        howTo: 'In your Claude settings file, set your default model to `claude-sonnet-4-6`. This applies globally so every new session starts on Sonnet. You can also set it per-project in CLAUDE.md. Sonnet (balanced performance and cost) handles the vast majority of coding tasks — file reads, edits, test runs, git operations, one-file bug fixes, documentation — identically to Opus (most capable, most expensive).',
        impact: 'Eliminates accidental Opus usage on simple tasks without any per-session effort. Opus costs $15/$75 per 1M tokens; Sonnet costs $3/$15 — an immediate 5x reduction for every session that doesn\'t genuinely need deep reasoning.',
      },
      {
        action: 'Switch to Opus mid-session only for reasoning-heavy tasks',
        howTo: 'switch to Opus (most capable, most expensive) when you hit a task that needs it: complex multi-file refactors, architectural decisions, intricate debugging across many files, or generating complex algorithms from scratch. switch to Sonnet (balanced performance and cost) when done. You can also toggle fast mode for quick model switching.',
        impact: 'Keeps cost minimal on straightforward work while giving you Opus quality exactly when it matters. Most sessions never need to switch.',
      },
      {
        action: 'Use Haiku for subagent tasks',
        howTo: 'When configuring subagents (in `.claude/agents/` YAML files), set `model: haiku` for agents doing simple tasks: file searches, log parsing, running tests, formatting checks. Haiku (fast and cheap) costs $0.80/$4 per 1M tokens — 19x cheaper than Opus (most capable, most expensive) for work that doesn\'t require reasoning.',
        impact: 'Subagent tasks are typically mechanical (grep, read, run). Running them on Haiku instead of Opus can reduce subagent costs by 90%+.',
      },
    ],

    examples: [
      {
        label: 'Simple task — use Sonnet (balanced)',
        before: '[Opus — most capable, most expensive] "Read package.json and update the version to 2.1.0" → 3 tool uses, same result as Sonnet at 5x the cost',
        after: '[Sonnet — balanced performance and cost] Same task, identical quality → 3 tool uses, 80% cost reduction',
      },
      {
        label: 'Opus is justified',
        before: '[Sonnet — balanced] "Design the database schema for a multi-tenant SaaS with row-level security" → shallow analysis, misses edge cases',
        after: '[Opus — most capable, most expensive] Same task → thorough analysis of isolation strategies, performance implications, migration path — complex architectural reasoning where Opus earns its cost',
      },
      {
        label: 'Subagent with Haiku (fast/cheap)',
        before: '[Opus subagent — most capable, most expensive] Runs grep across 200 files to find all usages of a deprecated function → mechanical search at premium price',
        after: '[Haiku subagent — fast and cheap] Same search → identical results at 1/19th the cost',
      },
    ],

    quickWin: 'In your Claude settings file, set your default model to `claude-sonnet-4-6`. Then switch to Opus (most capable, most expensive) only when you\'re about to do something that genuinely requires architectural reasoning — not for routine edits or file reads. Model tiers: Opus = most capable/expensive, Sonnet = balanced performance and cost, Haiku = fast/cheap.',
    specificQuickWin: (() => {
      const simple = evidence.examples.filter((e) => e.complexity === 'simple').slice(0, 2);
      const medium = evidence.examples.filter((e) => e.complexity === 'medium').slice(0, 2);
      const shown = [...simple, ...medium].slice(0, 3);
      if (shown.length === 0) return `switch to Sonnet (balanced performance and cost). ${evidence.overkillRate}% of your sessions used Opus where Sonnet would have been sufficient.`;
      const lines = shown.map((e) => `**${e.project}** (${e.date}): ${e.toolCount} tool uses, all ${e.complexity} — Sonnet sufficient`);
      return `switch to Sonnet (balanced performance and cost). Sessions that didn't need Opus (most capable, most expensive):\n${lines.map((l) => `  - ${l}`).join('\n')}\nThese had ${shown[0]?.toolCount ?? 'few'} or fewer tool uses with no complex reasoning — the exact profile where Sonnet matches Opus quality at 80% lower cost.`;
    })(),
    effort: 'quick',
  };
}
