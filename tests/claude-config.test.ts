import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findClaudeMdFiles,
  readClaudeMd,
  writeClaudeMd,
  extractManagedBlock,
  replaceManagedBlock,
  fileExists,
  createTestFixture,
} from '../src/claude-config.js';

describe('claude-config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tokenomics-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('findClaudeMdFiles', () => {
    it('returns global target when no project dir', () => {
      const targets = findClaudeMdFiles();
      expect(targets).toHaveLength(1);
      expect(targets[0]!.scope).toBe('global');
      expect(targets[0]!.filePath).toContain('.claude');
      expect(targets[0]!.filePath).toContain('CLAUDE.md');
    });

    it('returns global + project targets when project dir provided', () => {
      const targets = findClaudeMdFiles('/my/project');
      expect(targets).toHaveLength(2);
      expect(targets[0]!.scope).toBe('global');
      expect(targets[1]!.scope).toBe('project');
      expect(targets[1]!.filePath).toBe('/my/project/.claude/CLAUDE.md');
    });
  });

  describe('readClaudeMd', () => {
    it('returns empty string for non-existent file', async () => {
      const result = await readClaudeMd(join(tempDir, 'nope.md'));
      expect(result).toBe('');
    });

    it('reads existing file content', async () => {
      const path = await createTestFixture(tempDir, 'CLAUDE.md', '# Hello');
      const result = await readClaudeMd(path);
      expect(result).toBe('# Hello');
    });

    it('reads file with markers', async () => {
      const content = '# Before\n<!-- TOKENOMICS:START -->\nOld stuff\n<!-- TOKENOMICS:END -->\n# After';
      const path = await createTestFixture(tempDir, 'CLAUDE.md', content);
      const result = await readClaudeMd(path);
      expect(result).toContain('TOKENOMICS:START');
    });
  });

  describe('writeClaudeMd', () => {
    it('creates file and parent directories', async () => {
      const path = join(tempDir, 'nested', 'dir', 'CLAUDE.md');
      await writeClaudeMd(path, '# Test');
      const content = await readClaudeMd(path);
      expect(content).toBe('# Test');
    });

    it('overwrites existing file', async () => {
      const path = await createTestFixture(tempDir, 'CLAUDE.md', 'old');
      await writeClaudeMd(path, 'new');
      const content = await readClaudeMd(path);
      expect(content).toBe('new');
    });
  });

  describe('extractManagedBlock', () => {
    it('returns all content as before when no markers', () => {
      const content = '# My Rules\nAlways use TypeScript.\n';
      const result = extractManagedBlock(content);
      expect(result.before).toBe(content);
      expect(result.block).toBe('');
      expect(result.after).toBe('');
    });

    it('extracts managed block with markers', () => {
      const content = '# Before\n<!-- TOKENOMICS:START -->\nManaged\n<!-- TOKENOMICS:END -->\n# After';
      const result = extractManagedBlock(content);
      expect(result.before).toBe('# Before\n');
      expect(result.block).toBe('\nManaged\n');
      expect(result.after).toBe('\n# After');
    });

    it('handles empty managed block', () => {
      const content = '# Before\n<!-- TOKENOMICS:START -->\n<!-- TOKENOMICS:END -->\n# After';
      const result = extractManagedBlock(content);
      expect(result.before).toBe('# Before\n');
      // Between markers: just the newline between START and END
      expect(result.block).toBe('\n');
      expect(result.after).toBe('\n# After');
    });

    it('handles missing end marker', () => {
      const content = '# Before\n<!-- TOKENOMICS:START -->\nNo end marker';
      const result = extractManagedBlock(content);
      expect(result.before).toBe(content);
      expect(result.block).toBe('');
    });

    it('handles missing start marker', () => {
      const content = 'No start marker\n<!-- TOKENOMICS:END -->\n# After';
      const result = extractManagedBlock(content);
      expect(result.before).toBe(content);
    });
  });

  describe('replaceManagedBlock', () => {
    it('replaces existing managed block preserving before/after', () => {
      const content = '# My Rules\nAlways use TypeScript.\n<!-- TOKENOMICS:START -->\nOld findings from last week.\n<!-- TOKENOMICS:END -->\n# More Rules\nUse async/await.';
      const result = replaceManagedBlock(content, 'New findings from today.');

      expect(result).toContain('New findings from today.');
      expect(result).not.toContain('Old findings from last week.');
      expect(result).toContain('# My Rules');
      expect(result).toContain('Always use TypeScript.');
      expect(result).toContain('# More Rules');
      expect(result).toContain('Use async/await.');
    });

    it('appends managed block when no markers exist', () => {
      const content = '# My Rules\nAlways use TypeScript.';
      const result = replaceManagedBlock(content, 'New findings.');

      expect(result).toContain('New findings.');
      expect(result).toContain('TOKENOMICS:START');
      expect(result).toContain('TOKENOMICS:END');
      expect(result).toContain('# My Rules');
    });

    it('creates managed block from empty content', () => {
      const result = replaceManagedBlock('', 'New findings.');
      expect(result).toContain('TOKENOMICS:START');
      expect(result).toContain('New findings.');
      expect(result).toContain('TOKENOMICS:END');
    });

    it('is idempotent — running twice produces same output', () => {
      const content = '# Rules\n<!-- TOKENOMICS:START -->\nOld\n<!-- TOKENOMICS:END -->\n';
      const first = replaceManagedBlock(content, 'New findings.');
      const second = replaceManagedBlock(first, 'New findings.');
      expect(first).toBe(second);
    });
  });

  describe('fileExists', () => {
    it('returns true for existing file', async () => {
      const path = await createTestFixture(tempDir, 'exists.md', 'content');
      expect(await fileExists(path)).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await fileExists(join(tempDir, 'nope.md'))).toBe(false);
    });
  });
});
