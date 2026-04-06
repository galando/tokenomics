/**
 * Smart Model Router
 *
 * Analyzes prompt complexity and routes to the optimal model.
 * Reuses complexity classification logic from model-selection.ts.
 */

import type { SessionData, PromptSignals, RouteDecision, RouterEvidence, DetectorResult } from './types.js';

// Keyword patterns for complexity detection
const COMPLEX_KEYWORDS = [
  'design', 'architecture', 'schema', 'system', 'multi-tenant',
  'refactor', 'optimize', 'algorithm', 'complex', 'intricate',
  'debugging across', 'multiple files', 'integration', 'api design',
  'database design', 'security', 'authentication', 'authorization',
  'performance optimization', 'scalability', 'migration',
];

const SIMPLE_KEYWORDS = [
  'fix', 'typo', 'rename', 'format', 'update', 'change', 'add',
  'remove', 'delete', 'read', 'show', 'list', 'check', 'test',
  'run', 'build', 'compile', 'lint', 'format', 'sort', 'filter',
];

// File reference patterns (file.ts, path/to/file, etc.)
const FILE_REF_PATTERN = /[\w\-./]+\.(ts|js|tsx|jsx|py|java|go|rs|css|html|md|json|yaml|yml)/gi;

// Tools considered "simple" — basic file/code operations
const SIMPLE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']);

/**
 * Extract signals from a prompt for routing decisions.
 */
export function extractSignals(prompt: string): PromptSignals {
  const words = prompt.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Check for keywords
  const lowerPrompt = prompt.toLowerCase();
  const hasSimpleKeywords = SIMPLE_KEYWORDS.some(kw => lowerPrompt.includes(kw));
  const hasComplexKeywords = COMPLEX_KEYWORDS.some(kw => lowerPrompt.includes(kw));

  // Extract file references
  const fileMatches = prompt.match(FILE_REF_PATTERN) ?? [];
  const fileReferences = [...new Set(fileMatches)]; // Deduplicate
  const fileReferenceCount = fileReferences.length;

  return {
    wordCount,
    hasSimpleKeywords,
    hasComplexKeywords,
    fileReferenceCount,
    fileReferences,
  };
}

/**
 * Build a baseline profile from historical session data.
 */
export function buildProjectBaseline(sessions: SessionData[]): RouterEvidence {
  if (sessions.length === 0) {
    return {
      avgToolCount: 0,
      avgFileSpan: 0,
      simpleSessionRate: 0,
      totalSessions: 0,
    };
  }

  // Calculate average tool count
  const totalTools = sessions.reduce((sum, s) => sum + s.toolUses.length, 0);
  const avgToolCount = totalTools / sessions.length;

  // Calculate average file span (unique files accessed)
  // We'll estimate this from tool uses - Read/Edit tools on different files
  const fileSpans = sessions.map(s => {
    const files = new Set();
    for (const tool of s.toolUses) {
      if (tool.name === 'Read' || tool.name === 'Edit' || tool.name === 'Write') {
        const path = tool.input.path as string | undefined;
        if (path) {
          files.add(path);
        }
      }
    }
    return files.size;
  });
  const avgFileSpan = fileSpans.reduce((sum, count) => sum + count, 0) / sessions.length;

  // Classify sessions and calculate simple rate
  let simpleCount = 0;

  for (const session of sessions) {
    const toolCount = session.toolUses.length;
    const toolNames = new Set(session.toolUses.map(t => t.name));

    // Simple: <5 tools, all basic
    if (toolCount < 5 && [...toolNames].every(t => SIMPLE_TOOLS.has(t as string))) {
      simpleCount++;
    }
  }

  const simpleSessionRate = sessions.length > 0 ? (simpleCount / sessions.length) * 100 : 0;

  return {
    avgToolCount: Math.round(avgToolCount * 10) / 10,
    avgFileSpan: Math.round(avgFileSpan * 10) / 10,
    simpleSessionRate: Math.round(simpleSessionRate),
    totalSessions: sessions.length,
  };
}

/**
 * Route a prompt to the optimal model based on signals and historical baseline.
 */
export function routePrompt(signals: PromptSignals, baseline?: RouterEvidence): RouteDecision {
  const { wordCount, hasSimpleKeywords, hasComplexKeywords, fileReferenceCount } = signals;

  // Priority chain for routing

  // 1. Complex keywords -> Opus
  if (hasComplexKeywords) {
    return {
      model: 'claude-opus-4-6',
      confidence: 0.85,
      reason: 'Complex reasoning keywords detected',
      estimatedSavings: '~0% vs Opus (already optimal)',
      signals,
    };
  }

  // 2. Historical pattern: if project has high simple rate, default to Sonnet
  if (baseline && baseline.simpleSessionRate > 60 && !hasComplexKeywords) {
    return {
      model: 'claude-sonnet-4-6',
      confidence: 0.75,
      reason: `Project has ${baseline.simpleSessionRate}% simple sessions - Sonnet is usually sufficient`,
      estimatedSavings: '~80% vs Opus',
      signals,
    };
  }

  // 3. Structural analysis
  if (wordCount < 10 && fileReferenceCount === 0 && !hasComplexKeywords) {
    // Very vague prompt - might need more context, but Sonnet should handle it
    return {
      model: 'claude-sonnet-4-6',
      confidence: 0.70,
      reason: 'Simple request - Sonnet can handle',
      estimatedSavings: '~80% vs Opus',
      signals,
    };
  }

  if (wordCount > 50 || fileReferenceCount > 3) {
    // Longer prompt or multi-file reference -> likely complex
    return {
      model: 'claude-opus-4-6',
      confidence: 0.80,
      reason: fileReferenceCount > 3
        ? `References ${fileReferenceCount} files - likely complex task`
        : 'Detailed prompt - may require complex reasoning',
      estimatedSavings: '~0% vs Opus (already optimal)',
      signals,
    };
  }

  // 4. Simple keywords -> Sonnet
  if (hasSimpleKeywords && !hasComplexKeywords) {
    return {
      model: 'claude-sonnet-4-6',
      confidence: 0.85,
      reason: 'Simple task keywords detected',
      estimatedSavings: '~80% vs Opus',
      signals,
    };
  }

  // 5. Default: Sonnet (safe default for most tasks)
  return {
    model: 'claude-sonnet-4-6',
    confidence: 0.70,
    reason: 'Default model for general tasks',
    estimatedSavings: '~80% vs Opus',
    signals,
  };
}

/**
 * Render routing decision as CLI output.
 */
export function renderRouteOutput(decision: RouteDecision): string {
  const lines: string[] = [];

  lines.push('Recommended Model:');
  lines.push(`  ${decision.model}`);

  lines.push('');
  lines.push(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  lines.push(`Reason: ${decision.reason}`);
  lines.push(`Estimated Savings: ${decision.estimatedSavings}`);

  // Add signal details in verbose mode
  if (decision.signals.wordCount > 0) {
    lines.push('');
    lines.push('Signals:');
    lines.push(`  Words: ${decision.signals.wordCount}`);
    lines.push(`  File references: ${decision.signals.fileReferenceCount}`);
    if (decision.signals.hasSimpleKeywords) {
      lines.push(`  Simple keywords: yes`);
    }
    if (decision.signals.hasComplexKeywords) {
      lines.push(`  Complex keywords: yes`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert router analysis to detector result format for integration.
 */
export function routerToDetectorResult(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  const baseline = buildProjectBaseline(sessions);

  // If simple rate is high enough to be actionable
  if (baseline.simpleSessionRate < 50) {
    return null; // Not enough signal
  }

  const simpleSessions = sessions.filter(s => {
    return s.toolUses.length < 5 && s.toolUses.every(t => SIMPLE_TOOLS.has(t.name));
  });

  // Calculate potential savings
  const simpleSessionTokens = simpleSessions.reduce(
    (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens,
    0
  );

  const totalTokens = sessions.reduce(
    (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens,
    0
  );

  const savingsPercent = totalTokens > 0 ? Math.round((simpleSessionTokens / totalTokens) * 100 * 0.8) : 0; // 80% savings on simple sessions

  const severity: 'high' | 'medium' | 'low' =
    baseline.simpleSessionRate > 70 ? 'high' : baseline.simpleSessionRate > 50 ? 'medium' : 'low';

  return {
    detector: 'smart-router',
    title: 'Smart Model Routing',
    severity,
    savingsPercent,
    savingsTokens: Math.round(simpleSessionTokens * 0.8), // 80% savings
    confidence: 0.75,
    evidence: {
      simpleSessionRate: baseline.simpleSessionRate,
      avgToolCount: baseline.avgToolCount,
      avgFileSpan: baseline.avgFileSpan,
      totalSessions: baseline.totalSessions,
      simpleSessionCount: simpleSessions.length,
    },
    remediation: {
      problem: `${baseline.simpleSessionRate}% of your sessions (${simpleSessions.length} of ${baseline.totalSessions}) are simple tasks that could use Sonnet instead of Opus.`,
      whyItMatters: 'Sonnet handles simple tasks identically to Opus but uses ~80% fewer tokens. For routine edits, file reads, and small fixes, there\'s no quality difference.',
      steps: [
        {
          action: 'Use Sonnet as default model',
          howTo: 'Set Sonnet as your default model in Claude settings or CLAUDE.md',
          impact: 'Reduces token usage by ~80% on simple tasks without quality loss',
        },
        {
          action: 'Switch to Opus only for complex tasks',
          howTo: 'Manually switch to Opus when you need deep reasoning: architecture design, complex debugging, multi-file refactors',
          impact: 'Keeps token usage minimal while getting Opus quality when it matters',
        },
      ],
      examples: [
        {
          label: 'Simple task - use Sonnet',
          before: 'Running "fix the typo" on Opus uses 5x the tokens for identical result',
          after: 'Same task on Sonnet - identical quality, 80% fewer tokens',
        },
      ],
      quickWin: 'Set Sonnet as your default model. Your sessions show ' +
        `${baseline.simpleSessionRate}% are simple tasks where Sonnet matches Opus quality.`,
      specificQuickWin: `${simpleSessions.length} of your ${baseline.totalSessions} sessions are simple (under 5 tools). ` +
        `Use Sonnet for these and save ~80% on tokens.`,
      effort: 'quick',
    },
    sessionBreakdown: simpleSessions.slice(0, 5).map(s =>
      `  - **${s.project}** (${s.startedAt.split('T')[0]}): ${s.toolUses.length} tools, ${s.slug} → **Sonnet sufficient**`
    ).join('\n') || '_No specific sessions to call out._',
  };
}
