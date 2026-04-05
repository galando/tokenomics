/**
 * Model Selection Detector
 *
 * Flags sessions where a more powerful model was used for simple tasks
 * that could have been handled by a lighter model.
 * Agent-aware: supports Claude Code, Cursor, Copilot, Codex.
 *
 * Algorithm:
 * - Classify session complexity:
 *   - Simple: <5 tool uses, all Read/Edit/Bash
 *   - Medium: 5-15 tool uses OR any Agent tool
 *   - Complex: >15 tool uses OR multi-file refactors
 * - Check if model choice matches complexity (per-agent model tiers)
 * - Calculate token waste using model multiplier ratios
 */

import type { SessionData, DetectorResult, Remediation, AgentContext } from '../types.js';
import { mapToolName, adjustConfidenceForEstimates } from './agent-context.js';

interface ModelSelectionEvidence {
  overkillSessions: number;
  totalSessions: number;
  overkillRate: number;
  estimatedWastePercent: number;
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

// Model token multiplier ratios (relative to baseline = 1x)
// Used to estimate token waste when an overpowered model is used for simple tasks
const MODEL_MULTIPLIER: Record<string, number> = {
  // Claude models
  'opus': 5,
  'sonnet': 1,
  'haiku': 0.2,
  // OpenAI models
  'o1': 4,
  'o3': 3,
  'gpt-4o': 1.5,
  'gpt-4o-mini': 0.5,
  'unknown': 1,
};

// Universal tool names (after mapping via agent adapter)
const SIMPLE_TOOLS = new Set(['read', 'edit', 'write', 'bash', 'search']);

// Model tiers per agent
const AGENT_MODEL_TIERS: Record<string, Record<string, string>> = {
  'claude-code': {
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
    'claude-haiku-4-6': 'haiku',
  },
  'cursor': {
    'gpt-4o': 'sonnet',
    'gpt-4o-mini': 'haiku',
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
  },
  'copilot': {
    'gpt-4o': 'sonnet',
    'o1': 'opus',
    'o3-mini': 'haiku',
  },
  'codex': {
    'o3': 'opus',
    'o4-mini': 'haiku',
    'codex-mini': 'haiku',
  },
};

interface SessionComplexity {
  complexity: 'simple' | 'medium' | 'complex';
  suggestedModel: string;
  reason: string;
}

function analyzeComplexity(session: SessionData, agentId: string): SessionComplexity {
  const toolCount = session.toolUses.length;

  // Map tool names to universal concepts
  const mappedTools = session.toolUses.map((t) => mapToolName(agentId, t.name));
  const toolNames = new Set(mappedTools);

  // Check for Agent/subagent tool usage (always complex)
  if (toolNames.has('subagent')) {
    return {
      complexity: 'complex',
      suggestedModel: agentId === 'claude-code' ? 'claude-opus-4-6' : 'gpt-4o',
      reason: 'Uses subagent tool',
    };
  }

  // Complex: many total tool uses
  if (toolCount > 15) {
    return {
      complexity: 'complex',
      suggestedModel: agentId === 'claude-code' ? 'claude-opus-4-6' : 'gpt-4o',
      reason: 'Many operations',
    };
  }

  // Simple: few tools, all basic
  if (toolCount < 5) {
    const allSimple = [...toolNames].every((t) => SIMPLE_TOOLS.has(t));
    if (allSimple) {
      return {
        complexity: 'simple',
        suggestedModel: agentId === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-4o-mini',
        reason: 'Few simple operations',
      };
    }
  }

  // Medium: moderate exploration
  const readCount = mappedTools.filter((t) => t === 'read').length;
  if (readCount > 10) {
    return {
      complexity: 'medium',
      suggestedModel: agentId === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-4o',
      reason: 'Heavy exploration',
    };
  }

  return {
    complexity: 'medium',
    suggestedModel: agentId === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-4o',
    reason: 'Standard complexity',
  };
}

function getModelTier(model: string, agentId: string): 'opus' | 'sonnet' | 'haiku' | 'unknown' {
  const agentTiers = AGENT_MODEL_TIERS[agentId];
  if (!agentTiers) return 'unknown';

  const lower = model.toLowerCase();
  for (const [key, tier] of Object.entries(agentTiers)) {
    if (lower.includes(key.toLowerCase())) {
      return tier as 'opus' | 'sonnet' | 'haiku';
    }
  }

  return 'unknown';
}

function isOverkill(model: string, suggestedModel: string, agentId: string): boolean {
  const modelTier = getModelTier(model, agentId);
  const suggestedTier = getModelTier(suggestedModel, agentId);

  const tierOrder = { haiku: 0, sonnet: 1, opus: 2, unknown: 3 };
  return tierOrder[modelTier] > tierOrder[suggestedTier];
}

export function detectModelSelection(sessions: SessionData[], _agentContext?: AgentContext): DetectorResult | null {
  if (sessions.length === 0) return null;

  const overkillSessions: Array<{
    session: SessionData;
    complexity: SessionComplexity;
  }> = [];

  for (const session of sessions) {
    const agentId = session.agent;

    // Skip sessions with unknown/synthetic models or no tool activity
    if (getModelTier(session.model, agentId) === 'unknown') continue;
    if (session.toolUses.length === 0 && session.totalInputTokens < 1000) continue;

    const complexity = analyzeComplexity(session, agentId);

    if (isOverkill(session.model, complexity.suggestedModel, agentId)) {
      overkillSessions.push({ session, complexity });
    }
  }

  if (overkillSessions.length === 0) return null;

  const overkillRate = (overkillSessions.length / sessions.length) * 100;

  // Calculate estimated token waste from overkill model usage
  let wastedTokens = 0;
  const examples: ModelSelectionEvidence['examples'] = [];

  for (const { session, complexity } of overkillSessions.slice(0, 10)) {
    const agentId = session.agent;
    const currentTier = getModelTier(session.model, agentId);
    const suggestedTier = getModelTier(complexity.suggestedModel, agentId);
    const currentMult = MODEL_MULTIPLIER[currentTier] ?? 1;
    const suggestedMult = MODEL_MULTIPLIER[suggestedTier] ?? 1;

    if (currentMult > suggestedMult) {
      // Wasted tokens = tokens that would NOT have been needed on a leaner model
      // (proportional to the multiplier difference)
      const sessionTokens = session.totalInputTokens + session.totalOutputTokens;
      wastedTokens += Math.round(sessionTokens * (1 - suggestedMult / currentMult));
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

  // Calculate savings as percentage of total tokens
  const savingsPercent = totalTokens > 0 ? Math.round((wastedTokens / totalTokens) * 100) : 0;

  const severity: 'high' | 'medium' | 'low' =
    overkillRate > 30 ? 'high' : overkillRate > 15 ? 'medium' : 'low';

  let confidence = Math.min(0.9, 0.5 + overkillSessions.length * 0.03);

  // Adjust confidence for estimated tokens
  confidence = adjustConfidenceForEstimates(confidence, sessions);

  const evidence: ModelSelectionEvidence = {
    overkillSessions: overkillSessions.length,
    totalSessions: sessions.length,
    overkillRate: Math.round(overkillRate),
    estimatedWastePercent: savingsPercent,
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
    savingsTokens: wastedTokens,
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
    problem: `${evidence.overkillSessions} of your ${evidence.totalSessions} sessions (${evidence.overkillRate}%) used Opus when Sonnet would have been sufficient. By project: ${projectLines || `${evidence.overkillSessions} sessions`}. ${simpleExamples.length > 0 ? `${simpleExamples.length} of these were simple tasks (under 5 tool uses, all basic Read/Edit/Bash) where Opus adds no quality benefit over Sonnet.` : ''}`,

    whyItMatters: `Opus processes ~5x more tokens per task than Sonnet for identical work on simple tasks. For the sessions flagged above, the tasks didn't require deep reasoning: ${simpleExamples.length > 0 ? `things like "${simpleExamples[0]!.complexity}" work in **${simpleExamples[0]!.project}** with only ${simpleExamples[0]!.toolCount} tool uses` : 'routine edits and exploration'}. Sonnet handles these identically. Your ${evidence.overkillRate}% overkill rate means ~1 in every ${Math.round(100 / Math.max(evidence.overkillRate, 1))} sessions wastes tokens by running on an unnecessarily powerful model. Since every token in every turn is processed, this is the highest-leverage single setting to change.`,

    steps: [
      {
        action: 'Set Sonnet as your default model',
        howTo: 'In your Claude settings file, set your default model to `claude-sonnet-4-6`. This applies globally so every new session starts on Sonnet. You can also set it per-project in CLAUDE.md. Sonnet handles the vast majority of coding tasks — file reads, edits, test runs, git operations, one-file bug fixes, documentation — identically to Opus.',
        impact: 'Eliminates accidental Opus usage on simple tasks without any per-session effort. Switching to Sonnet for straightforward work reduces token processing by ~5x per session that doesn\'t genuinely need deep reasoning.',
      },
      {
        action: 'Switch to Opus mid-session only for reasoning-heavy tasks',
        howTo: 'Switch to Opus when you hit a task that needs it: complex multi-file refactors, architectural decisions, intricate debugging across many files, or generating complex algorithms from scratch. Switch back to Sonnet when done. You can also toggle fast mode for quick model switching.',
        impact: 'Keeps token usage minimal on straightforward work while giving you Opus quality exactly when it matters. Most sessions never need to switch.',
      },
      {
        action: 'Use Haiku for subagent tasks',
        howTo: 'When configuring subagents (in `.claude/agents/` YAML files), set `model: haiku` for agents doing simple tasks: file searches, log parsing, running tests, formatting checks. Haiku is ~19x more token-efficient than Opus for work that doesn\'t require reasoning.',
        impact: 'Subagent tasks are typically mechanical (grep, read, run). Running them on Haiku instead of Opus reduces subagent token consumption by 90%+.',
      },
    ],

    examples: [
      {
        label: 'Simple task — use Sonnet',
        before: '[Opus] "Read package.json and update the version to 2.1.0" → 3 tool uses, same result as Sonnet but ~5x more tokens processed',
        after: '[Sonnet] Same task, identical quality → 3 tool uses, ~80% fewer tokens processed',
      },
      {
        label: 'Opus is justified',
        before: '[Sonnet] "Design the database schema for a multi-tenant SaaS with row-level security" → shallow analysis, misses edge cases',
        after: '[Opus] Same task → thorough analysis of isolation strategies, performance implications, migration path — complex architectural reasoning where Opus justifies the extra tokens',
      },
      {
        label: 'Subagent with Haiku',
        before: '[Opus subagent] Runs grep across 200 files to find all usages of a deprecated function → mechanical search with heavy token processing',
        after: '[Haiku subagent] Same search → identical results at ~1/19th the token usage',
      },
    ],

    quickWin: 'In your Claude settings file, set your default model to `claude-sonnet-4-6`. Then switch to Opus only when you\'re about to do something that genuinely requires architectural reasoning — not for routine edits or file reads.',
    specificQuickWin: (() => {
      const simple = evidence.examples.filter((e) => e.complexity === 'simple').slice(0, 2);
      const medium = evidence.examples.filter((e) => e.complexity === 'medium').slice(0, 2);
      const shown = [...simple, ...medium].slice(0, 3);
      if (shown.length === 0) return `Switch to Sonnet as your default. ${evidence.overkillRate}% of your sessions used Opus where Sonnet would have been sufficient.`;
      const lines = shown.map((e) => `**${e.project}** (${e.date}): ${e.toolCount} tool uses, all ${e.complexity} — Sonnet sufficient`);
      return `Switch to Sonnet as your default. Sessions that didn't need Opus:\n${lines.map((l) => `  - ${l}`).join('\n')}\nThese had ${shown[0]?.toolCount ?? 'few'} or fewer tool uses with no complex reasoning — the exact profile where Sonnet matches Opus quality while using ~80% fewer tokens.`;
    })(),
    effort: 'quick',
  };
}
