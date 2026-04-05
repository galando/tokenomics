#!/usr/bin/env node
/**
 * Tokenomics — Token Intelligence for Claude Code
 *
 * Analyzes your Claude Code session history to find token waste patterns
 * and provide actionable recommendations. No LLM needed — runs locally.
 *
 * Usage:
 *   tokenomics              Terminal report (default)
 *   tokenomics --html       Open HTML report in browser
 *   tokenomics --json       Machine-readable JSON output
 *   tokenomics --report     Full markdown report
 *   tokenomics --fix        Apply auto-fixable optimizations
 *   tokenomics --fix --dry-run   Preview fixes without writing
 */

import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisOutput, CliOptions, DetectorResult, SessionData } from './types.js';
import { discoverFiles, logDiscoverySummary } from './discovery.js';
import { parseSessionFiles } from './parser.js';
import { runAllDetectors, runAsyncDetectors } from './detectors/registry.js';
import { renderHtmlReport } from './report-html.js';
import { injectFindings } from './injector.js';
import { installHooks } from './hooks.js';
import { optimizeSettings, applySettings } from './optimizer.js';
import { getAgentName } from './agents/registry.js';
import { initializeDefaultAdapters } from './agents/registry.js';

const VERSION = '1.4.0';

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      report: { type: 'boolean', default: false },
      html: { type: 'boolean', default: false },
      out: { type: 'string' },
      days: { type: 'string', default: '30' },
      project: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      fix: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'claude-dir': { type: 'string', multiple: true },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      inject: { type: 'boolean', default: false },
      setup: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      agent: { type: 'string', multiple: true },
      agents: { type: 'boolean', default: false },
      compare: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.version) {
    console.log(`tokenomics v${VERSION}`);
    process.exit(0);
  }

  return {
    json: values.json,
    report: values.report,
    html: values.html,
    out: values.out,
    days: parseInt(values.days, 10),
    project: values.project,
    verbose: values.verbose,
    help: values.help,
    fix: values.fix,
    dryRun: values['dry-run'],
    claudeDirs: (values['claude-dir'] as string[] | undefined) ?? [],
    inject: values.inject,
    setup: values.setup,
    quiet: values.quiet,
    agent: (values.agent as string[] | undefined) ?? [],
    agents: values.agents,
    compare: values.compare,
  };
}

function showHelp(): void {
  console.log(`
tokenomics — Token Intelligence for AI Coding Agents

Analyzes your AI coding agent session history to find token waste patterns
and provides actionable recommendations. Supports Claude Code, Cursor,
Copilot, and Codex. Runs locally, no LLM needed.

USAGE
  tokenomics [options]

OUTPUT MODES
  (default)            Terminal summary table
  --report             Full markdown coaching report
  --html               Generate HTML report and open in browser
  --json               Machine-readable JSON (pipe to jq, scripts, etc.)
  --out <file>         Write JSON to file (prints file path)

ANALYSIS
  --days <N>           Analyze last N days (default: 30)
  --project <P>        Filter to specific project path
  --agent <name>       Filter to specific agent (can be repeated)
                       Supported: claude-code, cursor, copilot, codex
  --agents             List all detected agents
  --compare            Show cross-agent comparison table
  --claude-dir <path>  Claude installation dir (default: auto-detect all)
                       Can be specified multiple times for custom selection

FIXES
  --fix                Apply auto-fixable optimizations
  --fix --dry-run      Preview fixes without writing files

INTEGRATION
  --setup              One-time setup: install hooks + initial injection
  --inject             Run analysis + inject findings into config files
  --quiet              Suppress output (used by SessionStart hooks)

OTHER
  --verbose            Show discovery progress and debug info
  --help               Show this message
  --version            Show version

WHAT --fix DOES
  1. Sets default model to Sonnet (saves ~5x tokens on simple sessions)
     Edits: ~/.claude/settings.json (or equivalent for other agents)
  2. Removes never-used MCP servers (reduces overhead on every session)
     Edits: ~/.claude.json (or equivalent for other agents)

EXAMPLES
  tokenomics                        Quick terminal summary (all agents)
  tokenomics --agent claude-code    Analyze only Claude Code sessions
  tokenomics --agent cursor --agent codex   Analyze Cursor + Codex
  tokenomics --agents               List detected agents
  tokenomics --compare              Cross-agent comparison
  tokenomics --html                 Beautiful HTML dashboard
  tokenomics --json --days 7        Last week's data as JSON
  tokenomics --fix --dry-run        Preview auto-fixes
  tokenomics --fix                  Apply fixes
`);
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

function calculateMetadata(sessions: SessionData[]): AnalysisOutput['metadata'] {
  if (sessions.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      sessionCount: 0,
      dateRange: { start: '', end: '' },
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      version: VERSION,
    };
  }

  const dates = sessions.flatMap((s) => [s.startedAt, s.endedAt]).filter(Boolean).sort();
  const totalTokens = sessions.reduce(
    (acc, s) => ({
      input: acc.input + s.totalInputTokens,
      output: acc.output + s.totalOutputTokens,
      cacheRead: acc.cacheRead + s.totalCacheReadTokens,
      cacheCreation: acc.cacheCreation + s.totalCacheCreationTokens,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  );

  // Extract agent information
  const agentIds = Array.from(new Set(sessions.map((s) => s.agent)));
  const agentNames = agentIds.map((id) => getAgentName(id) ?? id);

  // Calculate per-agent summaries
  const agentSummaries = agentIds.map((agentId) => {
    const agentSessions = sessions.filter((s) => s.agent === agentId);
    const agentTokens = agentSessions.reduce(
      (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
      0
    );

    return {
      agentId,
      agentName: getAgentName(agentId) ?? agentId,
      sessionCount: agentSessions.length,
      totalTokens: agentTokens,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    dateRange: {
      start: dates[0] ?? '',
      end: dates[dates.length - 1] ?? '',
    },
    totalTokens: {
      ...totalTokens,
      total: totalTokens.input + totalTokens.output + totalTokens.cacheRead + totalTokens.cacheCreation,
    },
    version: VERSION,
    agentNames: agentNames.length > 0 ? agentNames : undefined,
    agentSummaries: agentSummaries.length > 1 ? agentSummaries : undefined,
  };
}

// ─── Auto-Fix Logic ───────────────────────────────────────────────────────────

interface AppliedFix {
  detector: string;
  action: string;
  file: string;
  before: string;
  after: string;
}

interface ManualAction {
  detector: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  instruction: string;
  sessionBreakdown: string;
  finding?: DetectorResult;
}

interface FixOutput {
  dryRun: boolean;
  applied: AppliedFix[];
  skipped: Array<{ detector: string; reason: string }>;
  manual: ManualAction[];
}

function buildManualActions(findings: DetectorResult[], includeFinding: boolean = false): FixOutput['manual'] {
  const actions: FixOutput['manual'] = [];

  const autoFixable = new Set(['model-selection', 'mcp-tool-tax']);

  for (const f of findings) {
    if (autoFixable.has(f.detector)) continue; // handled by auto-fix
    const existing = actions.find(a => a.detector === f.detector);
    if (existing) continue;

    actions.push({
      detector: f.detector,
      priority: f.severity,
      title: f.title,
      instruction: f.remediation.steps.map(s => `${s.action}: ${s.howTo}`).join('\n'),
      sessionBreakdown: f.sessionBreakdown,
      ...(includeFinding ? { finding: f } : {}),
    });
  }

  return actions.sort((a, b) => {
    const prio = { high: 0, medium: 1, low: 2 };
    return prio[a.priority] - prio[b.priority];
  });
}

function renderFixOutput(output: FixOutput): void {
  const tick = '\x1b[32m\x1b[1m✓\x1b[0m';
  const cross = '\x1b[33m⏭\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const cyan = '\x1b[36m';

  console.log('');
  console.log(`${cyan}${bold}  TOKENOMICS FIX${reset}` + (output.dryRun ? ` ${yellow}(dry run — no changes written)${reset}` : ''));
  console.log(`${dim}  ${'─'.repeat(56)}${reset}`);
  console.log('');

  // Step 1: Analysis
  console.log(`${bold}  Step 1: Scanning your sessions...${reset}`);
  const totalFindings = output.applied.length + output.skipped.length + output.manual.length;
  console.log(`  Found ${totalFindings} optimization opportunit${totalFindings !== 1 ? 'ies' : 'y'} across your Claude Code sessions.`);
  console.log('');

  // Step 2: Auto-fixes
  if (output.applied.length > 0) {
    console.log(`${bold}  Step 2: Applying auto-fixes...${reset}`);
    for (const fix of output.applied) {
      console.log('');
      console.log(`  ${tick} ${green}${fix.action}${reset}`);
      console.log(`     ${dim}File:${reset}   ${fix.file}`);
      console.log(`     ${dim}Before:${reset} ${fix.before}`);
      console.log(`     ${dim}After:${reset}  ${fix.after}`);
    }
  } else if (output.skipped.length > 0) {
    console.log(`${bold}  Step 2: Checking for auto-fixes...${reset}`);
    console.log(`  ${cross} No auto-fixes applicable right now.`);
  }

  // Skipped items
  if (output.skipped.length > 0) {
    console.log('');
    console.log(`${bold}  Skipped:${reset}`);
    for (const s of output.skipped) {
      console.log(`  ${cross} ${s.detector}: ${s.reason}`);
    }
  }

  // Step 3: Manual actions
  if (output.manual.length > 0) {
    console.log('');
    console.log(`${'─'.repeat(58)}`);
    console.log(`${bold}  Step 3: Actions that need your manual attention${reset}`);
    console.log(`${dim}  These are habits, not settings — no script can automate them.${reset}`);
    console.log('');

    for (const action of output.manual) {
      const badge = action.priority === 'high' ? `${red}${bold}HIGH${reset}` : action.priority === 'medium' ? `${yellow}MED ${reset}` : `${cyan}LOW ${reset}`;
      console.log(`  [${badge}] ${bold}${action.title}${reset}`);
      const lines = action.instruction.split('\n');
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      if (action.sessionBreakdown && action.sessionBreakdown !== '_No specific sessions to call out._') {
        console.log(`${dim}    Affected sessions:${reset}`);
        const breakdown = action.sessionBreakdown.split('\n');
        for (const line of breakdown) {
          console.log(`    ${dim}${line}${reset}`);
        }
      }
      console.log('');
    }
  }

  // Summary
  console.log(`${dim}  ${'─'.repeat(56)}${reset}`);
  const totalApplied = output.applied.length;
  if (totalApplied > 0) {
    console.log(`${green}${bold}  Done:${reset} ${totalApplied} fix${totalApplied !== 1 ? 'es' : ''} applied.`);
  } else {
    console.log(`  Done: No auto-fixes were needed.`);
  }
  if (output.manual.length > 0) {
    console.log(`  ${yellow}${output.manual.length} manual action${output.manual.length !== 1 ? 's' : ''} still needed${reset} — see above.`);
  }
  console.log('');
}

// ─── Terminal Report Renderer ─────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function severityIcon(s: string): string {
  if (s === 'high') return '\x1b[31m●\x1b[0m';   // red
  if (s === 'medium') return '\x1b[33m●\x1b[0m';  // yellow
  return '\x1b[34m●\x1b[0m';                       // blue
}

function renderTerminalSummary(output: AnalysisOutput): void {
  const { metadata, findings } = output;
  const days = Math.round(
    (new Date(metadata.dateRange.end).getTime() - new Date(metadata.dateRange.start).getTime()) /
    86_400_000
  ) || 30;

  console.log('');
  console.log('\x1b[1m\x1b[36m  TOKENOMICS — Token Intelligence for AI Coding Agents\x1b[0m');
  console.log(`\x1b[2m  ${metadata.sessionCount} sessions // ${days} day range // v${VERSION}\x1b[0m`);

  // Show agent breakdown if multiple agents
  if (metadata.agentSummaries && metadata.agentSummaries.length > 1) {
    console.log('');
    console.log('  \x1b[1mAgents:\x1b[0m');
    for (const agent of metadata.agentSummaries) {
      const pct = metadata.totalTokens.total > 0
        ? ((agent.totalTokens / metadata.totalTokens.total) * 100).toFixed(1)
        : '0';
      console.log(`  • ${agent.agentName}: ${agent.sessionCount} sessions, ${fmt(agent.totalTokens)} tokens (${pct}%)`);
    }
  }

  console.log('');

  // Metrics strip
  const cacheHitRate = metadata.totalTokens.total > 0
    ? ((metadata.totalTokens.cacheRead / metadata.totalTokens.total) * 100).toFixed(1)
    : '0';

  console.log(`  Sessions:   ${metadata.sessionCount}`);
  console.log(`  Total:     ${fmt(metadata.totalTokens.total)} tokens`);
  console.log(`  Cache Hit: ${cacheHitRate}%`);
  console.log(`  Issues:    ${findings.length}`);
  console.log('');

  if (findings.length === 0) {
    console.log('\x1b[32m  No significant patterns detected. Your usage looks efficient.\x1b[0m');
    console.log('');
    return;
  }

  // Findings table
  const totalSavings = findings.reduce((s, f) => s + f.savingsPercent, 0);
  console.log('\x1b[1m  Findings:\x1b[0m');
  console.log('  ┌─────────────────────────┬──────────┬────────────┬────────────┐');
  console.log('  │ Detector                │ Severity │ Savings    │ Confidence │');
  console.log('  ├─────────────────────────┼──────────┼────────────┼────────────┤');

  for (const f of findings) {
    const sev = severityIcon(f.severity) + ' ' + f.severity.toUpperCase().padEnd(6);
    const title = f.title.padEnd(23).slice(0, 23);
    const savings = `~${f.savingsPercent}%`.padEnd(10);
    const conf = `${Math.round(f.confidence * 100)}%`.padEnd(10);
    console.log(`  │ ${title} │ ${sev} │ ${savings} │ ${conf} │`);
  }

  console.log('  └─────────────────────────┴──────────┴────────────┴────────────┘');
  console.log(`\n  \x1b[32mCombined potential: ~${totalSavings}% token reduction\x1b[0m`);

  // Top 3 quick wins
  const top3 = findings.slice(0, 3);
  if (top3.length > 0) {
    console.log('\n\x1b[1m  Quick Wins:\x1b[0m');
    top3.forEach((f, i) => {
      const qw = f.remediation.specificQuickWin.split('\n')[0]!.slice(0, 100);
      console.log(`  ${i + 1}. ${f.title}: ${qw}`);
    });
  }

  // Prominent fix callout
  const hasAutoFix = findings.some(f => f.detector === 'model-selection' || f.detector === 'mcp-tool-tax');
  if (hasAutoFix) {
    console.log('\n  \x1b[32m\x1b[1m  >>> Run \x1b[4mtokenomics --fix\x1b[24m to auto-fix some issues right now <<<\x1b[0m');
    console.log('  \x1b[2m  Use --fix --dry-run to preview first\x1b[0m');
  }

  console.log('\n  Run \x1b[1mtokenomics --html\x1b[0m for the full interactive dashboard');
  console.log('  Run \x1b[1mtokenomics --report\x1b[0m for the full markdown report');
  console.log('');
}

// ─── Markdown Report Renderer ─────────────────────────────────────────────────

function renderMarkdownReport(output: AnalysisOutput): string {
  const { metadata, findings } = output;
  const days = Math.round(
    (new Date(metadata.dateRange.end).getTime() - new Date(metadata.dateRange.start).getTime()) /
    86_400_000
  ) || 30;

  const lines: string[] = [];

  // Section 1: Summary
  lines.push(`## Token Usage Analysis (${days} days)\n`);
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Sessions | ${metadata.sessionCount} |`);
  lines.push(`| Total Tokens | ${fmt(metadata.totalTokens.total)} |`);
  lines.push(`| Cache Read | ${fmt(metadata.totalTokens.cacheRead)} |`);
  lines.push(`| Input | ${fmt(metadata.totalTokens.input)} |`);
  lines.push(`| Output | ${fmt(metadata.totalTokens.output)} |`);
  lines.push('');

  if (findings.length > 0) {
    const top = findings[0]!;
    lines.push(
      `The biggest opportunity is **${top.title}** — fixing it could save ~${top.savingsPercent}% of total tokens (~${fmt(top.savingsTokens)} tokens).`
    );
  } else {
    lines.push('No significant token-wasting patterns detected.');
  }
  lines.push('');
  lines.push('---');

  // Section 2: Detailed Findings
  findings.forEach((f, i) => {
    lines.push(
      `\n## ${i + 1}. ${f.title} — ${f.savingsPercent}% savings (${fmt(f.savingsTokens)} tokens, ${Math.round(f.confidence * 100)}% confidence)\n`
    );

    lines.push('**What\'s happening:**');
    lines.push(f.remediation.problem);
    lines.push('');
    lines.push('**Why this matters:**');
    lines.push(f.remediation.whyItMatters);
    lines.push('');
    lines.push('**How to fix it:**');
    for (const step of f.remediation.steps) {
      lines.push(`→ ${step.action}`);
      lines.push(`   How: ${step.howTo}`);
      lines.push(`   Impact: ${step.impact}`);
      lines.push('');
    }

    if (f.remediation.examples.length > 0) {
      for (const ex of f.remediation.examples) {
        lines.push(`  Before: ${ex.before}`);
        lines.push(`  After:  ${ex.after}`);
      }
      lines.push('');
    }

    lines.push(`**Quick win (${f.remediation.effort} effort):**`);
    lines.push(f.remediation.specificQuickWin);
    lines.push('');
    lines.push('---');
  });

  return lines.join('\n');
}

// ─── Cross-Agent Comparison ──────────────────────────────────────────────────

function renderAgentComparison(sessions: SessionData[], findings: DetectorResult[]): void {
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';

  const agentGroups = new Map<string, SessionData[]>();
  for (const s of sessions) {
    const existing = agentGroups.get(s.agent) ?? [];
    existing.push(s);
    agentGroups.set(s.agent, existing);
  }

  if (agentGroups.size < 2) {
    console.log('');
    console.log('  Cross-agent comparison requires sessions from at least 2 agents.');
    console.log(`  Found: ${agentGroups.size} agent(s). Use --agent to add more.`);
    console.log('');
    return;
  }

  console.log('');
  console.log(`${bold}${cyan}  CROSS-AGENT COMPARISON${reset}`);
  console.log(`${dim}  ${'─'.repeat(72)}${reset}`);
  console.log('');

  // Per-agent metrics table
  console.log('  ┌──────────────────┬──────────┬──────────────┬──────────────┬────────────┐');
  console.log('  │ Agent            │ Sessions │ Total Tokens │ Avg/session  │ Findings   │');
  console.log('  ├──────────────────┼──────────┼──────────────┼──────────────┼────────────┤');

  for (const [agentId, agentSessions] of agentGroups) {
    const name = getAgentName(agentId) ?? agentId;
    const totalTokens = agentSessions.reduce(
      (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens, 0,
    );
    const avgTokens = agentSessions.length > 0 ? Math.round(totalTokens / agentSessions.length) : 0;
    const agentFindings = findings.filter((f) => {
      const evidence = f.evidence as Record<string, unknown> | undefined;
      const examples = Array.isArray(evidence?.examples) ? evidence!.examples as Array<{ agent?: string }> : [];
      return examples.some((ex) => ex.agent === agentId) || (agentSessions.length > 0 && examples.length === 0);
    }).length;

    const label = name.length > 16 ? name.slice(0, 15) + '…' : name.padEnd(16);
    console.log(`  │ ${label} │ ${String(agentSessions.length).padStart(8)} │ ${fmt(totalTokens).padStart(12)} │ ${fmt(avgTokens).padStart(12)} │ ${String(agentFindings).padStart(10)} │`);
  }

  console.log('  └──────────────────┴──────────┴──────────────┴──────────────┴────────────┘');

  // Top findings per agent
  const agentFindingMap = new Map<string, DetectorResult[]>();
  for (const [agentId, agentSessions] of agentGroups) {
    const relevant = findings.slice(0, 5).map((f) => f.title);
    if (relevant.length > 0 || agentSessions.length > 0) {
      agentFindingMap.set(agentId, findings.slice(0, 3));
    }
  }

  if (agentFindingMap.size > 0) {
    console.log('');
    console.log(`${bold}  Top findings by agent:${reset}`);
    for (const [agentId, agentFindings] of agentFindingMap) {
      const name = getAgentName(agentId) ?? agentId;
      const color = agentId === 'claude-code' ? green : yellow;
      console.log(`  ${color}${name}:${reset}`);
      if (agentFindings.length === 0) {
        console.log('    No issues detected.');
      } else {
        for (const f of agentFindings.slice(0, 3)) {
          console.log(`    ${severityIcon(f.severity)} ${f.title} (~${f.savingsPercent}% savings)`);
        }
      }
    }
  }

  console.log('');
  console.log(`  Run ${bold}tokenomics --html${reset} for the full interactive dashboard`);
  console.log('');
}

// ─── Stubs for interactive fix (not yet implemented) ──────────────────────────

function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

async function renderInteractiveFix(_output: FixOutput, _data: { metadata: AnalysisOutput['metadata']; findings: DetectorResult[] }): Promise<void> {
  // Fallback to non-interactive rendering
  throw new Error('Interactive fix not implemented');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseCliArgs();

  // Initialize agent adapters
  initializeDefaultAdapters();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // --agents flag: list detected agents
  if (options.agents) {
    const { detectInstalledAgents } = await import('./agents/registry.js');
    const detected = await detectInstalledAgents();

    console.log('');
    console.log('\x1b[1m\x1b[36m  Detected Agents\x1b[0m');
    console.log('\x1b[2m  ' + '─'.repeat(56) + '\x1b[0m');
    console.log('');

    if (detected.length === 0) {
      console.log('  No agents detected.');
    } else {
      for (const agent of detected) {
        const installed = await agent.detect();
        void installed; // Used for detection side effect
        console.log(`  \x1b[32m✓\x1b[0m ${agent.name} (${agent.id})`);
      }
    }

    console.log('');
    console.log(`  Total: ${detected.length} agent${detected.length !== 1 ? 's' : ''} detected`);
    console.log('');
    return;
  }

  // Discover JSONL files (auto-detects all ~/.claude* installations)
  const discoveryOpts: import('./types.js').DiscoveryOptions & { agentIds?: string[] } = {
    days: options.days,
    project: options.project,
  };

  // Add agent filter if specified
  // CLI uses --agent (repeatable) → maps to DiscoveryOptions.agentIds
  if (options.agent.length > 0) {
    discoveryOpts.agentIds = options.agent;
  }

  // If user specified explicit claude-dir(s), use first one as primary
  if (options.claudeDirs.length > 0) {
    discoveryOpts.claudeDir = options.claudeDirs[0];
  }

  const files = await discoverFiles(discoveryOpts);

  if (options.verbose) {
    logDiscoverySummary(files, true);
  }

  // Parse all sessions
  const sessions = await parseSessionFiles(files);

  if (options.verbose) {
    console.error(`Parsed ${sessions.length} sessions`);
  }

  // Calculate metadata
  const metadata = calculateMetadata(sessions);

  // Run all detectors
  let findings = await runAllDetectors(sessions);
  const asyncFindings = await runAsyncDetectors(sessions);
  findings = [...findings, ...asyncFindings];

  // Sort by absolute token savings (descending)
  findings.sort((a, b) => b.savingsTokens - a.savingsTokens);

  if (options.verbose) {
    console.error(`Found ${findings.length} patterns`);
  }

  // ── Compare mode ──
  if (options.compare) {
    renderAgentComparison(sessions, findings);
    return;
  }

  // ── Setup mode ──
  if (options.setup) {
    const projectDir = process.cwd();
    const hookResult = await installHooks();
    const injectResult = await injectFindings(findings, projectDir, options.agent[0]);

    if (!options.quiet) {
      console.log('');
      console.log('\x1b[1m\x1b[36m  TOKENOMICS SETUP\x1b[0m');
      console.log('\x1b[2m  ' + '─'.repeat(56) + '\x1b[0m');
      console.log('');
      console.log(`  Hook:      ${hookResult.installed ? 'Installed' : 'Already installed'}`);
      console.log(`  Settings:  ${hookResult.path}`);
      console.log(`  Injected:  ${injectResult.instructionCount} instructions into ${injectResult.targets.length} CLAUDE.md file(s)`);
      for (const target of injectResult.targets) {
        const status = target.existed ? 'Updated' : 'Created';
        console.log(`    ${status}: ${target.filePath}`);
      }
      console.log('');
      console.log('  \x1b[32mSetup complete.\x1b[0m Findings will auto-inject on every new Claude Code session.');
      console.log('');
    }
    return;
  }

  // ── Inject mode ──
  if (options.inject) {
    const projectDir = process.cwd();
    const result = await injectFindings(findings, projectDir, options.agent[0]);

    if (!options.quiet) {
      if (result.changed) {
        console.log(`Injected ${result.instructionCount} instructions into ${result.targets.length} CLAUDE.md file(s)`);
      } else {
        console.log('No changes needed — findings unchanged since last injection');
      }
    }
    return;
  }

  // ── Fix mode ──
  if (options.fix) {
    // Use optimizer for structured settings changes
    const suggestedChanges = optimizeSettings(findings);
    const appliedChanges = await applySettings(suggestedChanges, !options.dryRun);

    const fixOutput: FixOutput = {
      dryRun: options.dryRun,
      applied: appliedChanges
        .filter(c => c.applied)
        .map(c => ({
          detector: c.change.type === 'model-default' ? 'model-selection' : 'mcp-tool-tax',
          action: c.change.type === 'model-default'
            ? `Set default model to ${c.change.suggested}`
            : `Removed unused MCP server(s)`,
          file: c.change.file,
          before: c.change.current,
          after: c.change.suggested,
        })),
      skipped: appliedChanges
        .filter(c => !c.applied)
        .map(c => ({
          detector: c.change.type === 'model-default' ? 'model-selection' : 'mcp-tool-tax',
          reason: c.change.type === 'model-default'
            ? 'Default model already sonnet/haiku, or settings file not found'
            : 'No never-used servers found or config files not accessible',
        })),
      manual: [],
    };

    fixOutput.manual = buildManualActions(findings);

    if (options.json) {
      // Strip finding data before JSON output (it's redundant)
      const { manual, ...jsonOutput } = fixOutput;
      console.log(JSON.stringify({ ...jsonOutput, manual: manual.map(({ finding, ...rest }) => rest) }, null, 2));
    } else if (isInteractive()) {
      fixOutput.manual = buildManualActions(findings, true);
      await renderInteractiveFix(fixOutput, { metadata, findings });
    } else {
      renderFixOutput(fixOutput);
    }

    // Also run injection after fixes
    if (!options.dryRun) {
      const injectResult = await injectFindings(findings, process.cwd(), options.agent[0]);
      if (!options.quiet && injectResult.changed) {
        console.log(`\n  Injected ${injectResult.instructionCount} insights into CLAUDE.md`);
      }
    }

    return;
  }

  // ── Analysis mode ──
  // Drop findings with zero savings — no actionable recommendation for reports
  findings = findings.filter(f => f.savingsTokens > 0);

  // Re-derive severity using hybrid approach:
  //   - Absolute floor/ceiling based on % of total tokens
  //   - Relative rank within the 1-10% band
  const topSavings = findings[0]?.savingsTokens ?? 0;
  if (topSavings > 0) {
    for (const f of findings) {
      const abs = f.savingsPercent;
      if (abs < 1) {
        f.severity = 'low';        // Floor: under 1% is always low
      } else if (abs >= 10) {
        f.severity = 'high';       // Ceiling: 10%+ is always high
      } else {
        // 1-10% band: rank relative to top finding
        const share = f.savingsTokens / topSavings;
        if (share >= 0.5) f.severity = 'high';
        else if (share >= 0.15) f.severity = 'medium';
        else f.severity = 'low';
      }
    }
  }

  const output: AnalysisOutput = { metadata, findings };

  if (options.html) {
    const outDir = join(homedir(), '.tokenomics');
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, 'report.html');
    writeFileSync(outFile, renderHtmlReport(output), 'utf-8');
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${openCmd} "${outFile}"`);
    console.log(`Report opened in browser: ${outFile}`);
  } else if (options.report) {
    console.log(renderMarkdownReport(output));
  } else if (options.json) {
    const json = JSON.stringify(output, null, options.verbose ? 2 : 0);
    if (options.out) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(options.out, json, 'utf-8');
      console.log(options.out);
    } else {
      console.log(json);
    }
  } else {
    renderTerminalSummary(output);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
