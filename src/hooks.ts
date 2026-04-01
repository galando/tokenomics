/**
 * SessionStart Hook Management — Data Optimization Layer
 *
 * Installs and unloads tokenomics hooks in Claude Code's settings.json.
 * Hooks run `tokenomics --inject --quiet` on every new session start.
 */

import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readSettingsJson, writeSettingsJson } from './claude-config.js';

// Use direct command if globally installed, fall back to npx
const HOOK_COMMAND = 'tokenomics --inject --quiet';

/**
 * Returns the hook command string.
 */
export function getHookCommand(): string {
  return HOOK_COMMAND;
}

/**
 * Check if the tokenomics SessionStart hook is installed.
 */
export async function isHookInstalled(): Promise<boolean> {
  const settings = await readSettingsJson();
  if (!settings) return false;

  const hooks = settings.content.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;

  const sessionStartHooks = hooks.SessionStart as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(sessionStartHooks)) return false;

  return sessionStartHooks.some(
    (entry) => {
      const entryHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      return Array.isArray(entryHooks) && entryHooks.some(
        (hook) => hook.command === HOOK_COMMAND || (typeof hook.command === 'string' && hook.command.includes('tokenomics --inject'))
      );
    }
  );
}

/**
 * Install SessionStart hook in settings.json.
 * Preserves existing hooks. Idempotent — no-op if already installed.
 */
export async function installHooks(): Promise<{ installed: boolean; path: string }> {
  const settings = await readSettingsJson();
  // Use the actual path from settings, or default
  const targetPath = settings?.path ?? join(process.env.HOME ?? '', '.claude', 'settings.json');

  // Ensure directory exists
  await mkdir(dirname(targetPath), { recursive: true });

  const content = settings?.content ?? {};

  // Get or create hooks section
  const hooks = (content.hooks as Record<string, unknown>) ?? {};
  const sessionStartHooks = (hooks.SessionStart as Array<Record<string, unknown>>) ?? [];

  // Check if already installed
  const alreadyInstalled = sessionStartHooks.some(
    (entry) => {
      const entryHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      return Array.isArray(entryHooks) && entryHooks.some(
        (hook) => hook.command === HOOK_COMMAND
      );
    }
  );

  if (alreadyInstalled) {
    return { installed: false, path: targetPath };
  }

  // Add the hook — Claude Code expects { matcher, hooks: [...] } entries
  const updatedHooks = {
    ...hooks,
    SessionStart: [
      ...sessionStartHooks,
      { matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] },
    ],
  };

  const updatedContent = { ...content, hooks: updatedHooks };
  await writeSettingsJson(targetPath, updatedContent);

  return { installed: true, path: targetPath };
}

/**
 * Uninstall tokenomics SessionStart hook from settings.json.
 * Preserves other hooks.
 */
export async function uninstallHooks(): Promise<{ removed: boolean; path: string }> {
  const settings = await readSettingsJson();

  if (!settings) {
    const defaultPath = join(process.env.HOME ?? '', '.claude', 'settings.json');
    return { removed: false, path: defaultPath };
  }

  const { path: settingsPath, content } = settings;
  const hooks = content.hooks as Record<string, unknown> | undefined;

  if (!hooks) {
    return { removed: false, path: settingsPath };
  }

  const sessionStartHooks = hooks.SessionStart as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(sessionStartHooks)) {
    return { removed: false, path: settingsPath };
  }

  const filtered = sessionStartHooks.filter(
    (entry) => {
      const entryHooks = entry.hooks as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(entryHooks)) return true; // keep non-matching entries
      return !entryHooks.some((hook) => hook.command === HOOK_COMMAND);
    }
  );

  if (filtered.length === sessionStartHooks.length) {
    return { removed: false, path: settingsPath };
  }

  const updatedHooks = { ...hooks, SessionStart: filtered };
  const updatedContent = { ...content, hooks: updatedHooks };
  await writeSettingsJson(settingsPath, updatedContent);

  return { removed: true, path: settingsPath };
}
