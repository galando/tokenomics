/**
 * Claude Code Config Read/Write — Data Optimization Layer
 *
 * Utility module for reading and writing Claude Code configuration files:
 * - CLAUDE.md (global and project-level)
 * - settings.json
 *
 * Uses HTML comment markers to manage injected sections:
 *   <!-- TOKENOMICS:START -->
 *   ... managed content ...
 *   <!-- TOKENOMICS:END -->
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { InjectionTarget } from './types.js';

const START_MARKER = '<!-- TOKENOMICS:START -->';
const END_MARKER = '<!-- TOKENOMICS:END -->';

/**
 * Find all CLAUDE.md file targets (global + project).
 * Returns paths even if files don't exist yet.
 */
export function findClaudeMdFiles(projectDir?: string): InjectionTarget[] {
  const targets: InjectionTarget[] = [];

  // Global: ~/.claude/CLAUDE.md
  targets.push({
    filePath: join(homedir(), '.claude', 'CLAUDE.md'),
    existed: false, // will be determined at read time
    scope: 'global',
  });

  // Project-level (if provided)
  if (projectDir) {
    targets.push({
      filePath: join(projectDir, '.claude', 'CLAUDE.md'),
      existed: false,
      scope: 'project',
    });
  }

  return targets;
}

/**
 * Read CLAUDE.md content. Returns '' if file doesn't exist.
 */
export async function readClaudeMd(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Write CLAUDE.md, creating parent directories if needed.
 */
export async function writeClaudeMd(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Check if a file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Split content at TOKENOMICS markers into before/block/after segments.
 * If no markers found, returns entire content as 'before'.
 */
export function extractManagedBlock(content: string): { before: string; block: string; after: string } {
  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { before: content, block: '', after: '' };
  }

  const before = content.slice(0, startIdx);
  const block = content.slice(startIdx + START_MARKER.length, endIdx);
  const after = content.slice(endIdx + END_MARKER.length);

  return { before, block, after };
}

/**
 * Replace content between TOKENOMICS markers with newBlock.
 * If no markers exist, appends the managed block at the end.
 */
export function replaceManagedBlock(content: string, newBlock: string): string {
  const { before, after } = extractManagedBlock(content);

  const managedSection = `${START_MARKER}\n${newBlock}\n${END_MARKER}`;

  if (before === content) {
    // No markers found — append
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n\n' : '\n';
    return content + separator + managedSection + '\n';
  }

  // Replace existing managed block
  return before + managedSection + after;
}

/**
 * Read ~/.claude/settings.json.
 * Returns null if file doesn't exist or isn't valid JSON.
 */
export async function readSettingsJson(): Promise<{ path: string; content: Record<string, unknown> } | null> {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  try {
    const raw = await readFile(settingsPath, 'utf-8');
    return { path: settingsPath, content: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * Write settings.json with consistent formatting.
 */
export async function writeSettingsJson(filePath: string, content: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
}

/**
 * Create a test fixture in a temp directory.
 * Returns the file path.
 */
export async function createTestFixture(dir: string, filename: string, content?: string): Promise<string> {
  const filePath = join(dir, filename);
  await writeClaudeMd(filePath, content ?? '');
  return filePath;
}
