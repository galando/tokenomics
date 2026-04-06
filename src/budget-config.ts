/**
 * Budget Configuration Management
 *
 * Reads and writes budget configuration from ~/.claude/tokenomics.json.
 * Follows the same pattern as claude-config.ts for consistency.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { BudgetConfig } from './types.js';

function getConfigPath(customPath?: string): string {
  return customPath ?? join(homedir(), '.claude', 'tokenomics.json');
}

/**
 * Default budget configuration.
 */
export const DEFAULT_BUDGET: BudgetConfig = {
  sessionCeiling: 500_000,
  dailyCeiling: 2_000_000,
  projectCeiling: 10_000_000,
  alertThresholds: [50, 80, 90],
  ceilingAction: 'warn',
  muteAlerts: false,
};

/**
 * Read budget configuration from ~/.claude/tokenomics.json.
 * Returns defaults if file doesn't exist or is invalid.
 */
export async function readBudgetConfig(customPath?: string): Promise<BudgetConfig> {
  const configPath = getConfigPath(customPath);
  try {
    const raw = await readFile(configPath, 'utf-8');
    const content = JSON.parse(raw) as Partial<BudgetConfig>;

    // Merge with defaults to ensure all fields exist
    return {
      sessionCeiling: content.sessionCeiling ?? DEFAULT_BUDGET.sessionCeiling,
      dailyCeiling: content.dailyCeiling ?? DEFAULT_BUDGET.dailyCeiling,
      projectCeiling: content.projectCeiling ?? DEFAULT_BUDGET.projectCeiling,
      alertThresholds: content.alertThresholds ?? DEFAULT_BUDGET.alertThresholds,
      ceilingAction: content.ceilingAction ?? DEFAULT_BUDGET.ceilingAction,
      muteAlerts: content.muteAlerts ?? DEFAULT_BUDGET.muteAlerts,
    };
  } catch {
    // File doesn't exist or is invalid JSON - return defaults
    return { ...DEFAULT_BUDGET };
  }
}

/**
 * Write budget configuration to ~/.claude/tokenomics.json.
 * Creates parent directories if needed.
 */
export async function writeBudgetConfig(config: BudgetConfig, customPath?: string): Promise<void> {
  const configPath = getConfigPath(customPath);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Ensure budget configuration exists.
 * Creates config with defaults if it doesn't exist.
 * Returns the current config (either existing or newly created).
 */
export async function ensureBudgetConfig(customPath?: string): Promise<{ created: boolean; config: BudgetConfig }> {
  const configPath = getConfigPath(customPath);

  // Check if config file exists using stat
  try {
    await stat(configPath);
    // File exists, read it
    const config = await readBudgetConfig(customPath);
    return { created: false, config };
  } catch {
    // File doesn't exist, create it with defaults
    await writeBudgetConfig(DEFAULT_BUDGET, customPath);
    return { created: true, config: { ...DEFAULT_BUDGET } };
  }
}
