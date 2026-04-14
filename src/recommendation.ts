/**
 * Human Readable Recommendations
 *
 * Converts detector findings into plain-English blocks with 4 parts:
 * Headline, Evidence, Consequence, Action.
 *
 * Terminal and HTML renderers consume the same HumanReadableBlock data,
 * ensuring consistent messaging across output formats.
 */

import type { DetectorResult, HumanReadableBlock, Severity } from './types.js';

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/**
 * Format an ISO timestamp into a human-readable date + time.
 * "2026-03-24T14:30:15Z" → "Mar 24 at 14:30"
 * Falls back to just the date if time info is missing.
 */
function fmtWhen(iso: string | undefined): string {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[d.getMonth()] ?? '?';
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${mon} ${day} at ${h}:${m}`;
}

/**
 * Truncate a prompt to fit in one line, showing enough to be recognizable.
 */
function fmtPrompt(prompt: string | undefined, maxLen = 80): string {
  if (!prompt) return '';
  const cleaned = prompt.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + '...';
}

// ─── Evidence extraction (per detector) ──────────────────────────────────────

interface ExtractedParts {
  headline: string;
  evidence: string;
  consequence: string;
  action: string;
}

function extractContextSnowball(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.worstSessions?.[0];
  const count = ev?.sessionsWithSnowball ?? '?';
  const total = ev?.totalSessions ?? '?';
  const rate = ev?.snowballRate ?? '?';
  const headline = `Your context window ballooned without /compact in ${count} of ${total} sessions (${rate}%).`;

  let evidenceText: string;
  if (worst) {
    const when = fmtWhen(worst.startedAt || worst.date);
    const prompt = fmtPrompt(worst.firstPrompt);
    evidenceText = `Worst: ${worst.project} on ${when} — context grew ${worst.growthMultiplier}x from turn ${worst.inflectionTurn}, wasting ${fmt(worst.excessTokens)} tokens.`;
    if (prompt) evidenceText += ` You were working on: "${prompt}"`;
  } else {
    evidenceText = `Across ${count} affected sessions, context expanded beyond 2.5x its starting size.`;
  }

  const consequence = `Every turn in a snowballed session re-sends the entire conversation history, compounding token cost.`;
  const action = `Run /compact after finishing a logical unit of work. When switching tasks entirely, run /clear to start fresh.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractModelSelection(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.examples?.[0];
  const count = ev?.overkillSessions ?? '?';
  const rate = ev?.overkillRate ?? '?';

  const headline = `You used Opus for ${count} sessions (${rate}%) where Sonnet would have produced the same result.`;

  let evidenceText: string;
  if (worst) {
    const when = fmtWhen(worst.startedAt || worst.date);
    const prompt = fmtPrompt(worst.firstPrompt);
    evidenceText = `Example: ${worst.project} on ${when} — ${worst.toolCount} tool uses, ${worst.complexity} complexity. ${worst.suggestedModel.replace('claude-', '')} was sufficient.`;
    if (prompt) evidenceText += ` Task: "${prompt}"`;
  } else {
    evidenceText = `These sessions had simple tasks with few tool uses that don't require Opus-level reasoning.`;
  }

  const consequence = `Opus processes ~5x more tokens per task than Sonnet for identical work on simple tasks.`;
  const action = `Run /model sonnet at the start of simple sessions. Switch to Opus only for architecture, complex debugging, or multi-file refactors.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractFileReadWaste(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.topDuplicates?.[0];
  const dupes = ev?.duplicateReads ?? 0;
  const sessions = ev?.sessionsWithWaste ?? '?';

  const headline = `Claude re-read the same files ${dupes} times across ${sessions} sessions without any changes.`;

  let evidenceText: string;
  if (worst) {
    const when = fmtWhen(worst.startedAt);
    evidenceText = `Worst offender: ${worst.file} in ${worst.project} (on ${when}) — read ${worst.count}x, wasting ~${fmt(worst.tokens)} tokens.`;
    const prompt = fmtPrompt(worst.firstPrompt);
    if (prompt) evidenceText += ` Session task: "${prompt}"`;
  } else {
    evidenceText = `Duplicate file reads inject the same content into context repeatedly for zero new information.`;
  }

  const consequence = `Each duplicate read adds 500-5,000 tokens to your context and raises the floor for all subsequent turns.`;
  const action = `Reference files by name ("in the auth.ts you already read") instead of asking Claude to re-read them.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractBashOutputBloat(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.examples?.[0];
  const sessions = ev?.sessionsWithBloat ?? '?';
  const rate = ev?.bloatRate ?? '?';

  const headline = `${sessions} sessions (${rate}%) ran bash commands that dumped excessive output into context.`;

  let evidenceText: string;
  if (worst) {
    const when = fmtWhen(worst.startedAt);
    evidenceText = `Example: \`${worst.command}\` in ${worst.project} on ${when} — ${worst.category}.`;
    const prompt = fmtPrompt(worst.firstPrompt);
    if (prompt) evidenceText += ` You were working on: "${prompt}"`;
  } else {
    evidenceText = `Commands like git log, find, and npm list produced thousands of lines of output that entered context permanently.`;
  }

  const consequence = `Bash output stays in the conversation for the entire session — one bad command can inject more tokens than 20 file reads.`;
  const action = `Add limits: git log -n 10 --oneline, find . | head -20. Pipe through grep or head to filter before it enters context.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractVaguePrompts(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.examples?.[0];
  const count = ev?.sessionsWithVaguePrompts ?? '?';
  const rate = ev?.vagueRate ?? '?';
  const clarifications = ev?.clarificationRounds ?? 0;

  const headline = `${count} sessions (${rate}%) started with prompts too vague for Claude to act on directly.`;

  let evidenceText: string;
  if (worst) {
    const prompt = fmtPrompt(worst.prompt, 100);
    evidenceText = `Example: "${prompt}" in ${worst.project} — ${worst.wordCount} words, flagged as: ${worst.vagueReason}.`;
  } else {
    evidenceText = `Vague prompts force Claude into exploration loops — reading files and asking questions before doing real work.`;
  }

  const consequence = `Vague prompts trigger ${clarifications} clarification rounds total, each adding turns and context before any productive work begins.`;
  const action = `Include the file path and what you want changed: "Fix the null check in src/auth.ts line 45" instead of "fix the bug".`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractSessionTiming(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const peakHours = ev?.peakHours ?? [];
  const lateNight = ev?.lateNightSessions ?? 0;
  const highIntensity = ev?.highIntensityWindows ?? 0;
  const total = ev?.totalSessions ?? '?';

  const peakStr = peakHours.map((h: number) => `${h}:00`).join(', ');
  const headline = lateNight > 0 || highIntensity > 3
    ? `Your session timing shows inefficiency: ${lateNight} late-night sessions and ${highIntensity} high-intensity hours.`
    : `Session timing patterns across ${total} sessions show room for optimization.`;
  const evidenceText = `Peak hours: ${peakStr || 'unknown'} UTC. Late-night sessions (10PM-6AM): ${lateNight} of ${total}. High-intensity windows: ${highIntensity} hours with >20% of sessions.`;
  const consequence = `Long sessions compound context — a 60-minute session often uses 3-4x more tokens per useful output than a 20-minute one.`;
  const action = `Keep sessions under 30 minutes. When context grows past 50%, run /compact. Stagger sessions across hours to avoid rate limits.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractSubagentOpportunity(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.examples?.[0];
  const count = ev?.sessionsWithOpportunity ?? '?';
  const rate = ev?.opportunityRate ?? '?';
  const avgChain = ev?.avgChainLength ?? '?';

  const headline = `${count} sessions (${rate}%) included long chains of file reads (${avgChain} reads average) that polluted main context.`;

  let evidenceText: string;
  if (worst) {
    const when = fmtWhen(worst.startedAt || worst.date);
    evidenceText = `Worst: ${worst.project} on ${when} — ${worst.chainLength} consecutive reads across ${worst.filesExplored} files.`;
    const prompt = fmtPrompt(worst.firstPrompt);
    if (prompt) evidenceText += ` Task: "${prompt}"`;
  } else {
    evidenceText = `Long exploration chains add file contents to your main context permanently.`;
  }

  const consequence = `Every file read in the chain stays in context for the entire session, compounding token cost on every subsequent turn.`;
  const action = `Prefix exploration requests with "Use a subagent to explore..." — reads happen in isolation and only the summary enters your main context.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractClaudeMdOverhead(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const worst = ev?.worstOffenders?.[0];
  const projectCount = ev?.projectsWithIssues ?? '?';

  const headline = `${projectCount} project(s) have oversized CLAUDE.md files that add overhead to every conversation turn.`;
  const evidenceText = worst
    ? `Heaviest: ${worst.project} at ${worst.tokenCount.toLocaleString()} tokens (~${Math.round(worst.sizeBytes / 1024)}KB), ${worst.sessionsAffected} sessions affected. Issues: ${worst.issues.slice(0, 2).join(', ') || 'oversized'}.`
    : `Large CLAUDE.md files inject thousands of tokens into every API call, even when the content is irrelevant.`;
  const consequence = `CLAUDE.md content is part of the system prompt — every token in it is charged on every single turn of every conversation.`;
  const action = `Trim CLAUDE.md to under 1,000 tokens. Remove config duplication and move procedures to on-demand instruction files. Run tokenomics --fix to review.`;
  return { headline, evidence: evidenceText, consequence, action };
}

function extractMcpToolTax(result: DetectorResult): ExtractedParts {
  const ev = result.evidence;
  const rarelyUsed = ev?.rarelyUsedServers ?? [];
  const neverUsed = ev?.neverUsedServers ?? [];
  const worst = rarelyUsed[0];

  const neverList = neverUsed.slice(0, 3).join(', ');
  const headline = neverUsed.length > 0
    ? `${neverUsed.length} MCP server(s) were loaded every session but never used: ${neverList}.`
    : rarelyUsed.length > 0
      ? `${rarelyUsed.length} MCP server(s) were used in fewer than 5% of sessions.`
      : `MCP server overhead detected.`;
  const evidenceText = worst
    ? `Example: "${worst.name}" — used in ${worst.sessionsUsed}/${worst.totalSessions} sessions (${worst.usageRate}%). ${neverUsed.length > 0 ? `Never used: ${neverList}.` : ''}`
    : `Every loaded server injects tool definitions into each API request, whether or not those tools are called.`;
  const consequence = `Each MCP server adds 100-500 tokens of overhead on every turn — a fixed per-turn tax across all sessions.`;
  const action = `Remove never-used servers from your Claude config. Move rarely-used ones to project-level config. Run tokenomics --fix to auto-remove unused servers.`;
  return { headline, evidence: evidenceText, consequence, action };
}

// ─── Generic fallback ────────────────────────────────────────────────────────

function extractGeneric(result: DetectorResult): ExtractedParts {
  return {
    headline: result.title || result.detector,
    evidence: result.remediation?.problem?.slice(0, 200) || 'No specific evidence available.',
    consequence: (() => { const s = result.remediation?.whyItMatters?.split('.')[0]; return s ? `${s}.` : 'This pattern wastes tokens across your sessions.'; })(),
    action: result.remediation?.specificQuickWin?.split('\n')[0] || 'Review the detailed report for specific actions.',
  };
}

// ─── Extractor dispatch ──────────────────────────────────────────────────────

const EXTRACTORS: Record<string, (result: DetectorResult) => ExtractedParts> = {
  'context-snowball': extractContextSnowball,
  'model-selection': extractModelSelection,
  'file-read-waste': extractFileReadWaste,
  'bash-output-bloat': extractBashOutputBloat,
  'vague-prompts': extractVaguePrompts,
  'session-timing': extractSessionTiming,
  'subagent-opportunity': extractSubagentOpportunity,
  'claude-md-overhead': extractClaudeMdOverhead,
  'mcp-tool-tax': extractMcpToolTax,
};

// ─── Public API ──────────────────────────────────────────────────────────────

export function extractHumanReadableBlock(result: DetectorResult): HumanReadableBlock {
  const extractor = EXTRACTORS[result.detector];
  let parts: ExtractedParts;
  try {
    parts = extractor ? extractor(result) : extractGeneric(result);
  } catch {
    parts = extractGeneric(result);
  }

  return {
    detector: result.detector,
    headline: parts.headline,
    evidence: parts.evidence,
    consequence: parts.consequence,
    action: parts.action,
  };
}

// ─── Terminal rendering ──────────────────────────────────────────────────────

function severityAnsi(severity: Severity): { icon: string; color: string; label: string } {
  switch (severity) {
    case 'high': return { icon: '\x1b[31m●\x1b[0m', color: '\x1b[31m', label: 'HIGH' };
    case 'medium': return { icon: '\x1b[33m●\x1b[0m', color: '\x1b[33m', label: 'MED' };
    case 'low': return { icon: '\x1b[34m●\x1b[0m', color: '\x1b[34m', label: 'LOW' };
  }
}

export function renderTerminalBlock(block: HumanReadableBlock, severity: Severity): string {
  const sev = severityAnsi(severity);
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const cyan = '\x1b[36m';

  const lines: string[] = [];
  lines.push(`  ${'─'.repeat(58)}`);
  lines.push(`  ${sev.icon} ${sev.color}${bold}${block.headline}${reset}`);
  lines.push('');
  lines.push(`  ${dim}Evidence:${reset}  ${block.evidence}`);
  lines.push(`  ${dim}Impact:${reset}    ${block.consequence}`);
  lines.push(`  ${cyan}Action:${reset}    ${block.action}`);
  lines.push('');

  return lines.join('\n');
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function severityHtml(severity: Severity): { color: string; label: string } {
  switch (severity) {
    case 'high': return { color: '#ff4d6a', label: 'HIGH' };
    case 'medium': return { color: '#ffbe2e', label: 'MODERATE' };
    case 'low': return { color: '#22d3ee', label: 'LOW' };
  }
}

export function renderHtmlBlock(block: HumanReadableBlock, severity: Severity): string {
  const sev = severityHtml(severity);

  return `<div class="finding-card" data-severity="${severity}" data-detector="${escapeHtml(block.detector)}">
  <div class="finding-card-header">
    <span class="sev-indicator" style="background:${sev.color};box-shadow:0 0 8px ${sev.color}40"></span>
    <span class="finding-card-title" style="color:${sev.color}">${escapeHtml(block.headline)}</span>
  </div>
  <div class="finding-card-body">
    <div class="finding-card-section">
      <span class="finding-card-label">Evidence</span>
      <p class="finding-card-text">${escapeHtml(block.evidence)}</p>
    </div>
    <div class="finding-card-section">
      <span class="finding-card-label">Why it matters</span>
      <p class="finding-card-text">${escapeHtml(block.consequence)}</p>
    </div>
    <div class="finding-card-section finding-card-action">
      <span class="finding-card-label">What to do</span>
      <p class="finding-card-text">${escapeHtml(block.action)}</p>
    </div>
  </div>
</div>`;
}
