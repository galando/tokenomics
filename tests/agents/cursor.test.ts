/**
 * Tests for Cursor adapter
 */

import { describe, it, expect } from 'vitest';
import { cursorAdapter } from '../../src/agents/cursor.js';
import type { SessionData } from '../../src/types.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => join(__dirname, '..', 'fixtures', 'cursor', name);

describe('Cursor Adapter', () => {
  describe('adapter metadata', () => {
    it('should have correct id and name', () => {
      expect(cursorAdapter.id).toBe('cursor');
      expect(cursorAdapter.name).toBe('Cursor');
    });

    it('should report correct capabilities', () => {
      expect(cursorAdapter.capabilities.hasNativeTokenCounts).toBe(false);
      expect(cursorAdapter.capabilities.hasModelInfo).toBe(true);
      expect(cursorAdapter.capabilities.hasToolUsage).toBe(true);
      expect(cursorAdapter.capabilities.hasTimingData).toBe(true);
      expect(cursorAdapter.capabilities.configFormat).toBe('json');
    });
  });

  describe('detect()', () => {
    it('should detect Cursor installation', async () => {
      const detected = await cursorAdapter.detect();
      expect(typeof detected).toBe('boolean');
    });
  });

  describe('discover()', () => {
    it('should return array of files', async () => {
      const files = await cursorAdapter.discover({ days: 30 });

      expect(Array.isArray(files)).toBe(true);
    });

    it('should include agent field in discovered files', async () => {
      const files = await cursorAdapter.discover({ days: 30 });

      for (const file of files) {
        expect(file.agent).toBe('cursor');
      }
    });
  });

  describe('parse()', () => {
    it('should parse Cursor fixture correctly', async () => {
      const fp = fixturePath('conversation-001.json');

      const session = await cursorAdapter.parse({
        path: fp,
        agent: 'cursor',
        projectPath: '',
        projectName: '',
        sessionId: 'conv-001',
        modifiedAt: new Date(),
        size: 0,
      });

      expect(session).not.toBeNull();
      expect(session?.agent).toBe('cursor');
      expect(session?.model).toBe('gpt-4o');
      expect(session?.rawTokenCounts).toBe(false); // Estimated tokens
    });

    it('should extract messages from conversation', async () => {
      const fp = fixturePath('conversation-001.json');

      const session = await cursorAdapter.parse({
        path: fp,
        agent: 'cursor',
        projectPath: '',
        projectName: '',
        sessionId: 'conv-001',
        modifiedAt: new Date(),
        size: 0,
      });

      expect(session?.messages.length).toBeGreaterThan(0);
      expect(session?.messages[0].role).toBe('user');
    });

    it('should extract tool uses', async () => {
      const fp = fixturePath('conversation-001.json');

      const session = await cursorAdapter.parse({
        path: fp,
        agent: 'cursor',
        projectPath: '',
        projectName: '',
        sessionId: 'conv-001',
        modifiedAt: new Date(),
        size: 0,
      });

      expect(session?.toolUses.length).toBeGreaterThan(0);
      expect(session?.toolUses[0].name).toBe('codebase_search');
    });

    it('should estimate tokens', async () => {
      const fp = fixturePath('conversation-001.json');

      const session = await cursorAdapter.parse({
        path: fp,
        agent: 'cursor',
        projectPath: '',
        projectName: '',
        sessionId: 'conv-001',
        modifiedAt: new Date(),
        size: 0,
      });

      expect(session?.totalInputTokens).toBeGreaterThan(0);
      expect(session?.totalOutputTokens).toBeGreaterThan(0);
    });

    it('should return null for invalid file', async () => {
      const session = await cursorAdapter.parse({
        path: '/nonexistent/file.json',
        agent: 'cursor',
        projectPath: '',
        projectName: '',
        sessionId: 'invalid',
        modifiedAt: new Date(),
        size: 0,
      });

      expect(session).toBeNull();
    });
  });

  describe('getConfigPaths()', () => {
    it('should return array of config paths', async () => {
      const paths = await cursorAdapter.getConfigPaths();

      expect(Array.isArray(paths)).toBe(true);
    });
  });

  describe('getBestPractices()', () => {
    it('should return Cursor-specific practices', () => {
      const practices = cursorAdapter.getBestPractices();

      expect(Array.isArray(practices)).toBe(true);
      expect(practices.length).toBeGreaterThan(0);

      const cursorRulesPractice = practices.find((p) => p.id === 'use-cursorrules');
      expect(cursorRulesPractice).toBeDefined();
      expect(cursorRulesPractice?.category).toBe('quality');
    });
  });

  describe('getToolMapping()', () => {
    it('should map Cursor tools to universal concepts', () => {
      const mapping = cursorAdapter.getToolMapping();

      expect(mapping.codebase_search).toBe('search');
      expect(mapping.file_edit).toBe('edit');
      expect(mapping.terminal).toBe('bash');
    });
  });
});
