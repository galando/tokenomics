import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getHookCommand, isHookInstalled, installHooks, uninstallHooks } from '../src/hooks.js';
import { readSettingsJson, writeSettingsJson } from '../src/claude-config.js';

// Override HOME for tests so hooks don't touch real settings
const originalHome = process.env.HOME;

describe('hooks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tokenomics-hooks-'));
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('getHookCommand', () => {
    it('returns expected command string', () => {
      expect(getHookCommand()).toBe('tokenomics --inject --quiet');
    });
  });

  describe('isHookInstalled', () => {
    it('returns false when no settings file exists', async () => {
      expect(await isHookInstalled()).toBe(false);
    });

    it('returns false when settings has no hooks', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus' }, null, 2),
      );
      expect(await isHookInstalled()).toBe(false);
    });

    it('returns true when hook is installed', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [
              { type: 'command', command: 'tokenomics --inject --quiet' },
            ],
          },
        }, null, 2),
      );
      expect(await isHookInstalled()).toBe(true);
    });
  });

  describe('installHooks', () => {
    it('adds entry to SessionStart array', async () => {
      const result = await installHooks();
      expect(result.installed).toBe(true);

      const settings = await readSettingsJson();
      expect(settings).not.toBeNull();
      const hooks = (settings!.content.hooks as Record<string, unknown>);
      const sessionStart = hooks.SessionStart as Array<Record<string, unknown>>;
      expect(sessionStart).toHaveLength(1);
      expect(sessionStart[0]!.command).toBe('tokenomics --inject --quiet');
    });

    it('preserves existing hooks', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [
              { type: 'command', command: 'other-hook --run' },
            ],
          },
        }, null, 2),
      );

      await installHooks();

      const settings = await readSettingsJson();
      const hooks = (settings!.content.hooks as Record<string, unknown>);
      const sessionStart = hooks.SessionStart as Array<Record<string, unknown>>;
      expect(sessionStart).toHaveLength(2);
      expect(sessionStart[0]!.command).toBe('other-hook --run');
    });

    it('is idempotent — install twice yields one entry', async () => {
      await installHooks();
      await installHooks();

      const settings = await readSettingsJson();
      const hooks = (settings!.content.hooks as Record<string, unknown>);
      const sessionStart = hooks.SessionStart as Array<Record<string, unknown>>;
      expect(sessionStart).toHaveLength(1);
    });
  });

  describe('uninstallHooks', () => {
    it('removes only tokenomics hook', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [
              { type: 'command', command: 'other-hook --run' },
              { type: 'command', command: 'tokenomics --inject --quiet' },
            ],
          },
        }, null, 2),
      );

      const result = await uninstallHooks();
      expect(result.removed).toBe(true);

      const settings = await readSettingsJson();
      const hooks = (settings!.content.hooks as Record<string, unknown>);
      const sessionStart = hooks.SessionStart as Array<Record<string, unknown>>;
      expect(sessionStart).toHaveLength(1);
      expect(sessionStart[0]!.command).toBe('other-hook --run');
    });

    it('preserves other hooks', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [
              { type: 'command', command: 'keep-me --running' },
            ],
          },
        }, null, 2),
      );

      await uninstallHooks();

      const settings = await readSettingsJson();
      const hooks = (settings!.content.hooks as Record<string, unknown>);
      const sessionStart = hooks.SessionStart as Array<Record<string, unknown>>;
      expect(sessionStart).toHaveLength(1);
    });

    it('returns removed: false when hook not present', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus' }, null, 2),
      );

      const result = await uninstallHooks();
      expect(result.removed).toBe(false);
    });
  });
});
