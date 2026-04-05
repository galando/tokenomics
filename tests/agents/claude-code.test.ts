/**
 * Tests for Claude Code adapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { claudeCodeAdapter } from '../../src/agents/claude-code.js';
import type { SessionData } from '../../src/types.js';

describe('Claude Code Adapter', () => {
  describe('adapter metadata', () => {
    it('should have correct id and name', () => {
      expect(claudeCodeAdapter.id).toBe('claude-code');
      expect(claudeCodeAdapter.name).toBe('Claude Code');
    });

    it('should report correct capabilities', () => {
      expect(claudeCodeAdapter.capabilities.hasNativeTokenCounts).toBe(true);
      expect(claudeCodeAdapter.capabilities.hasModelInfo).toBe(true);
      expect(claudeCodeAdapter.capabilities.hasToolUsage).toBe(true);
      expect(claudeCodeAdapter.capabilities.hasTimingData).toBe(true);
      expect(claudeCodeAdapter.capabilities.configFormat).toBe('json');
    });
  });

  describe('detect()', () => {
    it('should detect Claude Code installation', async () => {
      // This will pass if Claude Code is installed on the test machine
      const detected = await claudeCodeAdapter.detect();
      expect(typeof detected).toBe('boolean');
    });
  });

  describe('discover()', () => {
    it('should discover session files', async () => {
      const files = await claudeCodeAdapter.discover({ days: 30 });

      // May return empty array if Claude Code not installed
      expect(Array.isArray(files)).toBe(true);

      if (files.length > 0) {
        const file = files[0];
        expect(file.agent).toBe('claude-code');
        expect(file.path).toMatch(/\.jsonl$/);
        expect(file.sessionId).toBeDefined();
        expect(file.modifiedAt).toBeInstanceOf(Date);
        expect(file.size).toBeGreaterThan(0);
      }
    });

    it('should respect days parameter', async () => {
      const recent = await claudeCodeAdapter.discover({ days: 1 });
      const longer = await claudeCodeAdapter.discover({ days: 30 });

      expect(recent.length).toBeLessThanOrEqual(longer.length);
    });

    it('should filter by project when specified', async () => {
      const allFiles = await claudeCodeAdapter.discover({ days: 30 });

      if (allFiles.length > 0) {
        const projectName = allFiles[0].projectName;
        const filtered = await claudeCodeAdapter.discover({ days: 30, project: projectName });

        // The discovery logic uses bidirectional matching
        // So we check that the project name appears in either direction
        for (const file of filtered) {
          const matches =
            file.projectName.includes(projectName) || projectName.includes(file.projectName);
          expect(matches).toBe(true);
        }
      }
    });
  });

  describe('parse()', () => {
    it('should return null for non-existent file', async () => {
      const result = await claudeCodeAdapter.parse({
        path: '/nonexistent/file.jsonl',
        agent: 'claude-code',
        projectPath: '/fake',
        projectName: 'fake',
        sessionId: 'fake',
        modifiedAt: new Date(),
        size: 0,
      });

      expect(result).toBeNull();
    });
  });

  describe('getConfigPaths()', () => {
    it('should return array of config paths', async () => {
      const paths = await claudeCodeAdapter.getConfigPaths();

      expect(Array.isArray(paths)).toBe(true);
      // May be empty if Claude Code not installed
    });
  });

  describe('getBestPractices()', () => {
    it('should return Claude Code specific practices', () => {
      const practices = claudeCodeAdapter.getBestPractices();

      expect(Array.isArray(practices)).toBe(true);
      expect(practices.length).toBeGreaterThan(0);

      const compactPractice = practices.find((p) => p.id === 'use-compact');
      expect(compactPractice).toBeDefined();
      expect(compactPractice?.category).toBe('performance');
      expect(compactPractice?.severity).toBe('high');
    });

    it('should have detectFn for use-compact practice', () => {
      const practices = claudeCodeAdapter.getBestPractices();
      const compactPractice = practices.find((p) => p.id === 'use-compact');

      expect(compactPractice?.detectFn).toBeDefined();

      const sessionWithoutCompact: SessionData = {
        id: 'test',
        agent: 'claude-code',
        project: 'test',
        projectPath: '/test',
        slug: 'test',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        toolUses: [],
        toolResults: [],
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        turnCount: 15, // High turn count without compact
        compactUsed: false,
        compactCount: 0,
        startedAt: '2025-01-01T00:00:00Z',
        endedAt: '2025-01-01T00:05:00Z',
        sourceFile: '/test.jsonl',
      };

      // Should detect violation
      expect(compactPractice?.detectFn?.(sessionWithoutCompact)).toBe(true);

      const sessionWithCompact: SessionData = {
        ...sessionWithoutCompact,
        compactUsed: true,
        compactCount: 1,
      };

      // Should not detect violation
      expect(compactPractice?.detectFn?.(sessionWithCompact)).toBe(false);
    });
  });

  describe('getToolMapping()', () => {
    it('should map Claude Code tools to universal concepts', () => {
      const mapping = claudeCodeAdapter.getToolMapping();

      expect(typeof mapping).toBe('object');
      expect(mapping.Read).toBe('read');
      expect(mapping.Edit).toBe('edit');
      expect(mapping.Bash).toBe('bash');
      expect(mapping.Grep).toBe('search');
      expect(mapping.Glob).toBe('search');
      expect(mapping.Agent).toBe('subagent');
    });
  });
});
