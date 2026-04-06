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
import { extractSignals, routePrompt } from './router.js';
import { checkBudget, renderBudgetDashboard, renderBudgetCheckOutput } from './budget.js';
import { auditPrompt } from './auditor.js';
import { renderPromptOutput } from './prompt-output.js';
import { ensureBudgetConfig, readBudgetConfig } from './budget-config.js';

const VERSION = '2.0.0';

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
      prompt: { type: 'string' },
      budget: { type: 'boolean', default: false },
      'budget-check': { type: 'boolean', default: false },
      'no-alerts': { type: 'boolean', default: false },
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
    prompt: values.prompt,
    budget: values.budget,
    budgetCheck: values['budget-check'],
    noAlerts: values['no-alerts'],
  };
}

function showHelp(): void {
  console.log(`
tokenomics — Token Intelligence for Claude Code

Analyzes your Claude Code session history to find token waste patterns
and provides actionable recommendations. Runs locally, no LLM needed.

Auto-detects all ~/.claude* installation directories.

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
  --claude-dir <path>  Claude installation dir (default: auto-detect all)
                       Can be specified multiple times for custom selection

FIXES
  --fix                Apply auto-fixable optimizations
  --fix --dry-run      Preview fixes without writing files

INTEGRATION
  --setup              One-time setup: install hooks + initial injection
  --inject             Run analysis + inject findings into CLAUDE.md
  --quiet              Suppress output (used by SessionStart hooks)

PROMPT ANALYSIS
  --prompt <text>      Analyze a prompt: model recommendation + quality grade
  --budget             Show token budget dashboard
  --budget-check       Lightweight budget check (for hooks)
  --no-alerts          Suppress budget alerts (no CLAUDE.md injection)

OTHER
  --verbose            Show discovery progress and debug info
  --help               Show this message
  --version            Show version

WHAT --fix DOES
  1. Sets default model to Sonnet (saves ~5x tokens on simple sessions)
     Edits: ~/.claude/settings.json (or equivalent)
  2. Removes never-used MCP servers (reduces overhead on every session)
     Edits: ~/.claude.json (or equivalent)

EXAMPLES
  tokenomics                        Quick terminal summary
  tokenomics --html                 Beautiful HTML dashboard
  tokenomics --json --days 7        Last week's data as JSON
  tokenomics --fix --dry-run        Preview auto-fixes
  tokenomics --fix                  Apply fixes
  tokenomics --claude-dir ~/.claude-zai   Analyze specific installation
  tokenomics --prompt "fix bug"     Analyze prompt (model + grade)
  tokenomics --budget               Show budget dashboard
  tokenomics --prompt "design a schema"  Check complex prompt
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
  console.log('\x1b[1m\x1b[36m  TOKENOMICS — Token Intelligence for Claude Code\x1b[0m');
  console.log(`\x1b[2m  ${metadata.sessionCount} sessions // ${days} day range // v${VERSION}\x1b[0m`);
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

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseCliArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // --no-alerts only makes sense with --budget or --budget-check
  if (options.noAlerts && !options.budget && !options.budgetCheck) {
    console.error('Note: --no-alerts only works with --budget or --budget-check.');
    console.error('Example: tokenomics --budget --no-alerts');
    process.exit(1);
  }

  // ── Prompt analysis mode ──
  if (options.prompt) {
    const signals = extractSignals(options.prompt);
    const decision = routePrompt(signals);
    const report = auditPrompt(options.prompt);
    console.log(renderPromptOutput(decision, report));
    return;
  }

  // ── Budget mode (full dashboard with refresh) ──
  if (options.budget) {
    const config = await ensureBudgetConfig();
    const budgetConfig = { ...config.config, ...(options.noAlerts && { muteAlerts: true }) };
    const result = await checkBudget({ config: budgetConfig, forceRefresh: true });
    console.log(renderBudgetDashboard(result.states, budgetConfig, result.cachedScopes));
    return;
  }

  // ── Budget check mode (for hooks, uses cache) ──
  if (options.budgetCheck) {
    const config = await readBudgetConfig();
    const budgetConfig = { ...config, ...(options.noAlerts && { muteAlerts: true }) };
    const result = await checkBudget({ config: budgetConfig, forceRefresh: false });
    console.log(renderBudgetCheckOutput(result));
    process.exit(result.ceilingExceeded ? 1 : 0);
  }

  // Discover JSONL files (auto-detects all ~/.claude* installations)
  const discoveryOpts: import('./types.js').DiscoveryOptions = {
    days: options.days,
    project: options.project,
  };

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
  let findings = runAllDetectors(sessions);
  const asyncFindings = await runAsyncDetectors(sessions);
  findings = [...findings, ...asyncFindings];

  // Sort by absolute token savings (descending)
  findings.sort((a, b) => b.savingsTokens - a.savingsTokens);

  if (options.verbose) {
    console.error(`Found ${findings.length} patterns`);
  }

  // ── Setup mode ──
  if (options.setup) {
    const projectDir = process.cwd();
    const hookResult = await installHooks();
    const budgetConfigResult = await ensureBudgetConfig();
    const injectResult = await injectFindings(findings, projectDir);

    if (!options.quiet) {
      console.log('');
      console.log('\x1b[1m\x1b[36m  TOKENOMICS SETUP\x1b[0m');
      console.log('\x1b[2m  ' + '─'.repeat(56) + '\x1b[0m');
      console.log('');
      console.log(`  Hook:      ${hookResult.installed ? 'Installed' : 'Already installed'}`);
      console.log(`  Settings:  ${hookResult.path}`);
      console.log(`  Budget:    ${budgetConfigResult.created ? 'Created' : 'Exists'} (~/.claude/tokenomics.json)`);
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
    const result = await injectFindings(findings, projectDir);

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
    } else {
      renderFixOutput(fixOutput);
    }

    // Also run injection after fixes
    if (!options.dryRun) {
      const injectResult = await injectFindings(findings, process.cwd());
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
