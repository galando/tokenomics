/**
 * Settings Optimizer — Data Optimization Layer
 *
 * Evaluates detector findings and suggests structural settings changes:
 * - Model default changes (model-selection detector)
 * - MCP server removal (mcp-tool-tax detector)
 *
 * Reuses fix logic patterns from analyze.ts but as reusable functions.
 */

import type { DetectorResult, SettingsChange, AppliedChange } from './types.js';
import { readSettingsJson, writeSettingsJson } from './claude-config.js';

const AUTO_FIXABLE_DETECTORS = new Set(['model-selection', 'mcp-tool-tax']);

/**
 * Check if a detector has an auto-fix handler.
 */
export function isAutoFixable(detector: string): boolean {
  return AUTO_FIXABLE_DETECTORS.has(detector);
}

/**
 * Evaluate findings and return suggested settings changes.
 * Only suggests when confidence > 0.5.
 */
export function optimizeSettings(findings: DetectorResult[]): SettingsChange[] {
  const changes: SettingsChange[] = [];

  for (const finding of findings) {
    if (finding.confidence < 0.5) continue;

    if (finding.detector === 'model-selection') {
      const evidence = finding.evidence as { overkillRate?: number };
      const rate = Math.round((evidence.overkillRate ?? 0) * 100);

      changes.push({
        type: 'model-default',
        file: '~/.claude/settings.json',
        current: '(current model)',
        suggested: 'claude-sonnet-4-6',
        reason: `Opus used for ${rate}% of simple tasks. Sonnet is ~5x more token-efficient for editing, small fixes, and exploration.`,
        confidence: finding.confidence,
      });
    }

    if (finding.detector === 'mcp-tool-tax') {
      const evidence = finding.evidence as { neverUsedServers?: string[] };
      const neverUsed = evidence.neverUsedServers ?? [];

      if (neverUsed.length > 0) {
        changes.push({
          type: 'mcp-server-remove',
          file: '~/.claude/settings.json',
          current: neverUsed.join(', '),
          suggested: '(removed)',
          reason: `MCP servers [${neverUsed.join(', ')}] are loaded but never used. Removing reduces per-session overhead.`,
          confidence: finding.confidence,
        });
      }
    }
  }

  return changes;
}

/**
 * Apply settings changes (or dry-run).
 */
export async function applySettings(changes: SettingsChange[], dryRun: boolean): Promise<AppliedChange[]> {
  const results: AppliedChange[] = [];

  for (const change of changes) {
    if (change.type === 'model-default') {
      const applied = await applyModelDefault(change, dryRun);
      results.push(applied);
    } else if (change.type === 'mcp-server-remove') {
      const applied = await applyMcpRemove(change, dryRun);
      results.push(applied);
    }
  }

  return results;
}

async function applyModelDefault(change: SettingsChange, dryRun: boolean): Promise<AppliedChange> {
  const settings = await readSettingsJson();

  if (!settings) {
    return { change, applied: false };
  }

  const currentModel = (settings.content.model as string) ?? '(not set)';
  if (currentModel.includes('sonnet') || currentModel.includes('haiku')) {
    return { change, applied: false };
  }

  if (!dryRun) {
    const updated = { ...settings.content, model: change.suggested };
    await writeSettingsJson(settings.path, updated);
  }

  return { change: { ...change, current: currentModel }, applied: !dryRun };
}

async function applyMcpRemove(change: SettingsChange, dryRun: boolean): Promise<AppliedChange> {
  const settings = await readSettingsJson();

  if (!settings) {
    return { change, applied: false };
  }

  if (!settings.content.mcpServers || typeof settings.content.mcpServers !== 'object') {
    return { change, applied: false };
  }

  const servers = settings.content.mcpServers as Record<string, unknown>;
  const toRemove = change.current.split(', ').filter((name) => name in servers);

  if (toRemove.length === 0) {
    return { change, applied: false };
  }

  if (!dryRun) {
    const updated = { ...settings.content, mcpServers: { ...servers } };
    for (const name of toRemove) {
      delete (updated.mcpServers as Record<string, unknown>)[name];
    }
    await writeSettingsJson(settings.path, updated);
  }

  return { change, applied: !dryRun };
}
