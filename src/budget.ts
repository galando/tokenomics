/**
 * Token Budget Tracker
 *
 * Tracks token usage across session, daily, and project scopes.
 * Provides alerts and enforcement when thresholds are crossed.
 */

import { open, readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { BudgetConfig, BudgetState, BudgetScope, AlertEvent, BudgetCheckResult, BudgetCache, CheckBudgetOptions } from './types.js';
import { detectClaudeDirs, discoverFiles } from './discovery.js';
import { readBudgetConfig } from './budget-config.js';

// ── Alert State ──────────────────────────────────────────────

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

// ── Session Discovery ────────────────────────────────────────

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

// ── Token Summation ──────────────────────────────────────────

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
          total +=
            ((usage.input_tokens as number) ?? 0) +
            ((usage.output_tokens as number) ?? 0) +
            ((usage.cache_read_input_tokens as number) ?? 0) +
            ((usage.cache_creation_input_tokens as number) ?? 0);
        }
      }
    } catch {
      continue;
    }
  }

  return total;
}

/**
 * Stream a JSONL file line-by-line and sum tokens.
 * Avoids loading the full file into memory.
 */
export async function sumTokensFromStream(filePath: string): Promise<number> {
  let total = 0;

  const rl = createInterface({
    input: createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line) as Record<string, unknown>;

      if (record.type === 'assistant' && record.message) {
        const message = record.message as Record<string, unknown>;
        const usage = message.usage as Record<string, unknown> | undefined;

        if (usage) {
          total +=
            ((usage.input_tokens as number) ?? 0) +
            ((usage.output_tokens as number) ?? 0) +
            ((usage.cache_read_input_tokens as number) ?? 0) +
            ((usage.cache_creation_input_tokens as number) ?? 0);
        }
      }
    } catch {
      continue;
    }
  }

  return total;
}

// ── Active Session (fast tail-read) ──────────────────────────

export async function getActiveSessionTokens(claudeDir?: string): Promise<number> {
  const jsonlPath = await findActiveSessionJsonl(claudeDir);

  if (!jsonlPath) return 0;

  try {
    const fileStat = await stat(jsonlPath);
    const fileSize = fileStat.size;

    const TAIL_BYTES = 8192;
    const readStart = Math.max(0, fileSize - TAIL_BYTES);
    const readLength = fileSize - readStart;

    let content: string;
    if (readStart > 0) {
      const handle = await open(jsonlPath, 'r');
      try {
        const buffer = Buffer.alloc(readLength);
        await handle.read(buffer, 0, readLength, readStart);
        content = buffer.toString('utf-8');
      } finally {
        await handle.close();
      }
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        content = content.slice(firstNewline + 1);
      }
    } else {
      content = await readFile(jsonlPath, 'utf-8');
    }

    return sumTokensFromLines(content.trim().split('\n'));
  } catch {
    return 0;
  }
}

// ── Budget Cache ─────────────────────────────────────────────

function getBudgetCachePath(): string {
  return join(homedir(), '.claude', 'tokenomics-budget-cache.json');
}

export async function readBudgetCache(): Promise<BudgetCache | null> {
  try {
    const raw = await readFile(getBudgetCachePath(), 'utf-8');
    return JSON.parse(raw) as BudgetCache;
  } catch {
    return null;
  }
}

async function writeBudgetCache(cache: BudgetCache): Promise<void> {
  const path = getBudgetCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
}

// ── Aggregation (daily / project) ────────────────────────────

/**
 * Sum tokens from all JSONL files modified today.
 */
export async function getDailyTokens(claudeDir?: string): Promise<number> {
  const files = await discoverFiles({ days: 1, ...(claudeDir ? { claudeDir } : {}) });
  let total = 0;

  const BATCH = 20;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(f => sumTokensFromStream(f.path)));
    total += results.reduce((sum, n) => sum + n, 0);
  }

  return total;
}

/**
 * Sum tokens from all JSONL files in the last 30 days.
 */
export async function getProjectTokens(claudeDir?: string): Promise<number> {
  const files = await discoverFiles({ days: 30, ...(claudeDir ? { claudeDir } : {}) });
  let total = 0;

  const BATCH = 20;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(f => sumTokensFromStream(f.path)));
    total += results.reduce((sum, n) => sum + n, 0);
  }

  return total;
}

/**
 * Compute real daily/project totals and write to cache.
 */
export async function refreshBudgetCache(claudeDir?: string): Promise<BudgetCache> {
  const [daily, project] = await Promise.all([
    getDailyTokens(claudeDir),
    getProjectTokens(claudeDir),
  ]);

  const now = new Date().toISOString();
  const cache: BudgetCache = {
    daily: { tokens: daily, updatedAt: now },
    project: { tokens: project, updatedAt: now },
  };

  await writeBudgetCache(cache);
  return cache;
}

// ── Check Budget ─────────────────────────────────────────────

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
 * Supports both legacy (BudgetConfig, string?) and new (CheckBudgetOptions) signatures.
 */
export async function checkBudget(
  configOrOptions?: BudgetConfig | CheckBudgetOptions,
  claudeDir?: string
): Promise<BudgetCheckResult> {
  let budgetConfig: BudgetConfig;
  let dir: string | undefined;
  let forceRefresh = false;

  if (configOrOptions && typeof configOrOptions === 'object' && 'forceRefresh' in configOrOptions) {
    const opts = configOrOptions as CheckBudgetOptions;
    budgetConfig = opts.config ?? await readBudgetConfig();
    dir = opts.claudeDir ?? claudeDir;
    forceRefresh = opts.forceRefresh ?? false;
  } else {
    budgetConfig = (configOrOptions as BudgetConfig | undefined) ?? await readBudgetConfig();
    dir = claudeDir;
  }

  // Session scope — always fast tail-read
  const sessionTokens = await getActiveSessionTokens(dir);

  // Daily and project scopes
  let dailyTokens: number;
  let projectTokens: number;
  const cachedScopes = new Set<BudgetScope>();

  if (forceRefresh) {
    // Real aggregation (manual --budget command)
    const cache = await refreshBudgetCache(dir);
    dailyTokens = cache.daily.tokens;
    projectTokens = cache.project.tokens;
  } else {
    // Try cache first (hook path)
    const cache = await readBudgetCache();
    if (cache) {
      dailyTokens = cache.daily.tokens;
      projectTokens = cache.project.tokens;
      cachedScopes.add('daily').add('project');
    } else {
      // No cache yet — fall back to session tokens
      dailyTokens = sessionTokens;
      projectTokens = sessionTokens;
      cachedScopes.add('daily').add('project');
    }
  }

  const states: BudgetState[] = [
    createBudgetState('session', sessionTokens, budgetConfig.sessionCeiling),
    createBudgetState('daily', dailyTokens, budgetConfig.dailyCeiling),
    createBudgetState('project', projectTokens, budgetConfig.projectCeiling),
  ];

  // Alert logic
  const firedAlerts = await readFiredAlerts();
  const newAlerts: AlertEvent[] = [];
  let ceilingExceeded = false;
  let exceededScope: BudgetScope | undefined;

  for (const state of states) {
    if (state.percent >= 100) {
      ceilingExceeded = true;
      exceededScope = state.scope;
    }

    if (budgetConfig.muteAlerts) continue;

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

  if (newAlerts.length > 0) {
    await writeFiredAlerts(firedAlerts);
  }

  return {
    states,
    newAlerts,
    ceilingExceeded,
    exceededScope,
    cachedScopes,
  };
}

// ── Rendering ────────────────────────────────────────────────

/**
 * Render budget dashboard as ASCII progress bars.
 */
export function renderBudgetDashboard(
  states: BudgetState[],
  _config: BudgetConfig,
  cachedScopes?: Set<BudgetScope>
): string {
  const lines: string[] = [];

  lines.push('Token Budget Status');
  lines.push('='.repeat(50));
  lines.push('');

  for (const state of states) {
    const percentage = Math.round(state.percent);
    const filled = Math.round(percentage / 2);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(50 - filled);

    const emoji = percentage >= 90 ? '\u{1F534}' : percentage >= 75 ? '\u{1F7E1}' : '\u{1F7E2}';
    const cached = cachedScopes?.has(state.scope) ? ' (cached)' : '';

    lines.push(`${emoji} ${state.scope.toUpperCase()}: ${percentage}%${cached}`);
    lines.push(`  ${bar}`);
    lines.push(`  ${state.used.toLocaleString()} / ${state.ceiling.toLocaleString()} tokens`);
    lines.push('');
  }

  if (cachedScopes && cachedScopes.size > 0) {
    lines.push('Run `tokenomics --budget` to refresh daily/project totals.');
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
