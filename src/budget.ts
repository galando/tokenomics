/**
 * Token Budget Tracker
 *
 * Tracks token usage across session, daily, and project scopes.
 * Provides alerts and enforcement when thresholds are crossed.
 */

import { open, readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { BudgetConfig, BudgetState, BudgetScope, AlertEvent, BudgetCheckResult } from './types.js';
import { detectClaudeDirs } from './discovery.js';
import { readBudgetConfig } from './budget-config.js';

/**
 * Key for storing fired alert state: "scope:threshold" → timestamp
 */
interface FiredAlerts {
  [key: string]: string;
}

function getFiredAlertsPath(): string {
  return join(homedir(), '.claude', 'tokenomics-alerts.json');
}

async function readFiredAlerts(): Promise<FiredAlerts> {
  try {
    const raw = await readFile(getFiredAlertsPath(), 'utf-8');
    return JSON.parse(raw) as FiredAlerts;
  } catch {
    return {};
  }
}

async function writeFiredAlerts(fired: FiredAlerts): Promise<void> {
  const path = getFiredAlertsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(fired, null, 2) + '\n', 'utf-8');
}

function alertKey(scope: BudgetScope, threshold: number): string {
  return `${scope}:${threshold}`;
}

/**
 * Find the most recent active session JSONL file.
 * Returns null if no active session found.
 */
async function findActiveSessionJsonl(claudeDir?: string): Promise<string | null> {
  const dirs = claudeDir ? [claudeDir] : await detectClaudeDirs();

  for (const dir of dirs) {
    const projectsDir = join(dir, 'projects');

    try {
      const projects = await readdir(projectsDir);

      for (const project of projects) {
        const projectPath = join(projectsDir, project);

        try {
          const entries = await readdir(projectPath, { withFileTypes: true });
          const jsonlFiles = entries
            .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
            .map(e => join(projectPath, e.name));

          if (jsonlFiles.length === 0) continue;

          const filesWithTime = await Promise.all(
            jsonlFiles.map(async (path) => ({
              path,
              mtime: (await stat(path)).mtime.getTime(),
            }))
          );

          filesWithTime.sort((a, b) => b.mtime - a.mtime);

          return filesWithTime[0]!.path;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Parse token usage from JSONL lines.
 */
function sumTokensFromLines(lines: string[]): number {
  let total = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line) as Record<string, unknown>;

      if (record.type === 'assistant' && record.message) {
        const message = record.message as Record<string, unknown>;
        const usage = message.usage as Record<string, unknown> | undefined;

        if (usage) {
          const input = (usage.input_tokens as number) ?? 0;
          const output = (usage.output_tokens as number) ?? 0;
          const cacheRead = (usage.cache_read_input_tokens as number) ?? 0;
          const cacheCreation = (usage.cache_creation_input_tokens as number) ?? 0;

          total += input + output + cacheRead + cacheCreation;
        }
      }
    } catch {
      continue;
    }
  }

  return total;
}

/**
 * Get tokens from the most recent active session using true tail-read.
 * Only reads the last ~8KB of the file for <200ms performance.
 */
export async function getActiveSessionTokens(claudeDir?: string): Promise<number> {
  const jsonlPath = await findActiveSessionJsonl(claudeDir);

  if (!jsonlPath) return 0;

  try {
    const fileStat = await stat(jsonlPath);
    const fileSize = fileStat.size;

    // Read last 8KB (covers ~100 lines of typical JSONL)
    const TAIL_BYTES = 8192;
    const readStart = Math.max(0, fileSize - TAIL_BYTES);
    const readLength = fileSize - readStart;

    let content: string;
    if (readStart > 0) {
      // True tail-read: only read the end of the file
      const handle = await open(jsonlPath, 'r');
      try {
        const buffer = Buffer.alloc(readLength);
        await handle.read(buffer, 0, readLength, readStart);
        content = buffer.toString('utf-8');
      } finally {
        await handle.close();
      }
      // Discard partial first line (we started mid-file)
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        content = content.slice(firstNewline + 1);
      }
    } else {
      // Small file — just read it all
      content = await readFile(jsonlPath, 'utf-8');
    }

    return sumTokensFromLines(content.trim().split('\n'));
  } catch {
    return 0;
  }
}

/**
 * Create budget state for a specific scope.
 */
function createBudgetState(
  scope: BudgetScope,
  used: number,
  ceiling: number,
  project?: string
): BudgetState {
  return {
    scope,
    used,
    ceiling,
    percent: ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 0,
    project,
  };
}

/**
 * Check budget against configured ceilings and thresholds.
 * Tracks fired alerts persistently so each threshold fires exactly once.
 */
export async function checkBudget(config?: BudgetConfig, claudeDir?: string): Promise<BudgetCheckResult> {
  const budgetConfig = config ?? await readBudgetConfig();

  // Get token usage for all scopes
  const sessionTokens = await getActiveSessionTokens(claudeDir);

  // Daily and project scopes use session tokens as baseline
  // (full aggregation requires parsing all session files — deferred to future iteration)
  const dailyTokens = sessionTokens;
  const projectTokens = sessionTokens;

  // Create states for all scopes
  const states: BudgetState[] = [
    createBudgetState('session', sessionTokens, budgetConfig.sessionCeiling),
    createBudgetState('daily', dailyTokens, budgetConfig.dailyCeiling),
    createBudgetState('project', projectTokens, budgetConfig.projectCeiling),
  ];

  // Load previously fired alerts for deduplication
  const firedAlerts = await readFiredAlerts();
  const newAlerts: AlertEvent[] = [];
  let ceilingExceeded = false;
  let exceededScope: BudgetScope | undefined;

  for (const state of states) {
    // Check ceiling exceeded
    if (state.percent >= 100) {
      ceilingExceeded = true;
      exceededScope = state.scope;
    }

    // Check threshold crossings — fire exactly once per threshold per scope
    for (const threshold of budgetConfig.alertThresholds) {
      const key = alertKey(state.scope, threshold);

      if (state.percent >= threshold && !firedAlerts[key]) {
        firedAlerts[key] = new Date().toISOString();
        newAlerts.push({
          scope: state.scope,
          threshold,
          timestamp: firedAlerts[key]!,
          project: state.project,
        });
      }
    }
  }

  // Persist updated fired alerts
  if (newAlerts.length > 0) {
    await writeFiredAlerts(firedAlerts);
  }

  return {
    states,
    newAlerts,
    ceilingExceeded,
    exceededScope,
  };
}

/**
 * Render budget dashboard as ASCII progress bars.
 */
export function renderBudgetDashboard(states: BudgetState[], _config: BudgetConfig): string {
  const lines: string[] = [];

  lines.push('Token Budget Status');
  lines.push('='.repeat(50));
  lines.push('');

  for (const state of states) {
    const percentage = Math.round(state.percent);
    const filled = Math.round(percentage / 2); // 50 chars = 100%
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(50 - filled);

    const emoji = percentage >= 90 ? '\u{1F534}' : percentage >= 75 ? '\u{1F7E1}' : '\u{1F7E2}';

    lines.push(`${emoji} ${state.scope.toUpperCase()}: ${percentage}%`);
    lines.push(`  ${bar}`);
    lines.push(`  ${state.used.toLocaleString()} / ${state.ceiling.toLocaleString()} tokens`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render budget check output for hooks.
 */
export function renderBudgetCheckOutput(result: BudgetCheckResult): string {
  const lines: string[] = [];

  if (result.ceilingExceeded) {
    lines.push(`\u26A0\uFE0F  Budget ceiling exceeded: ${result.exceededScope}`);
  }

  if (result.newAlerts.length > 0) {
    for (const alert of result.newAlerts) {
      lines.push(`\u26A0\uFE0F  ${alert.scope} threshold: ${alert.threshold}%`);
    }
  }

  if (lines.length === 0) {
    lines.push('\u2705 All budgets within limits');
  }

  return lines.join('\n');
}
