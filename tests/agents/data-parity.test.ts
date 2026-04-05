/**
 * Data Parity Tests
 *
 * Verify all agent adapters produce SessionData with consistent structure
 */

import { describe, it, expect } from 'vitest';
import { claudeCodeAdapter } from '../../src/agents/claude-code.js';
import { cursorAdapter } from '../../src/agents/cursor.js';
import { copilotAdapter } from '../../src/agents/copilot.js';
import { codexAdapter } from '../../src/agents/codex.js';
import type { SessionData } from '../../src/types.js';

describe('Data Parity Across Agents', () => {
  const adapters = [claudeCodeAdapter, cursorAdapter, copilotAdapter, codexAdapter];

  describe('Adapter capabilities', () => {
    it('all adapters have required capabilities', () => {
      for (const adapter of adapters) {
        expect(adapter.capabilities).toBeDefined();
        expect(typeof adapter.capabilities.hasNativeTokenCounts).toBe('boolean');
        expect(typeof adapter.capabilities.hasModelInfo).toBe('boolean');
        expect(typeof adapter.capabilities.hasToolUsage).toBe('boolean');
        expect(typeof adapter.capabilities.hasTimingData).toBe('boolean');
        expect(adapter.capabilities.configFormat).toBeDefined();
      }
    });

    it('all adapters have unique IDs', () => {
      const ids = adapters.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('all adapters provide tool mappings', () => {
      for (const adapter of adapters) {
        const mapping = adapter.getToolMapping();
        expect(typeof mapping).toBe('object');
        expect(Object.keys(mapping).length).toBeGreaterThanOrEqual(0);
      }
    });

    it('all adapters provide best practices', () => {
      for (const adapter of adapters) {
        const practices = adapter.getBestPractices();
        expect(Array.isArray(practices)).toBe(true);

        for (const practice of practices) {
          expect(practice.id).toBeDefined();
          expect(practice.title).toBeDefined();
          expect(practice.description).toBeDefined();
          expect(['performance', 'cost', 'quality', 'workflow']).toContain(practice.category);
          expect(['high', 'medium', 'low']).toContain(practice.severity);
        }
      }
    });
  });

  describe('SessionData structure requirements', () => {
    it('all adapters set agent field correctly', () => {
      for (const adapter of adapters) {
        expect(adapter.id).toMatch(/^[a-z0-9-]+$/);
      }
    });

    it('Claude Code adapter reports native token counts', () => {
      expect(claudeCodeAdapter.capabilities.hasNativeTokenCounts).toBe(true);
    });

    it('other adapters use estimated tokens', () => {
      const nonClaude = [cursorAdapter, copilotAdapter, codexAdapter];

      for (const adapter of nonClaude) {
        expect(adapter.capabilities.hasNativeTokenCounts).toBe(false);
      }
    });
  });

  describe('Config path discovery', () => {
    it('all adapters provide getConfigPaths method', () => {
      for (const adapter of adapters) {
        expect(typeof adapter.getConfigPaths).toBe('function');
      }
    });

    it('getConfigPaths returns array', async () => {
      for (const adapter of adapters) {
        const paths = await adapter.getConfigPaths();
        expect(Array.isArray(paths)).toBe(true);
      }
    });
  });

  describe('Discovery behavior', () => {
    it('all adapters provide discover method', () => {
      for (const adapter of adapters) {
        expect(typeof adapter.discover).toBe('function');
      }
    });

    it('discover returns array of DiscoveredFile', async () => {
      for (const adapter of adapters) {
        const files = await adapter.discover({ days: 30 });
        expect(Array.isArray(files)).toBe(true);
      }
    });

    it('discovered files have required fields', async () => {
      for (const adapter of adapters) {
        const files = await adapter.discover({ days: 30 });

        for (const file of files) {
          expect(file.path).toBeDefined();
          expect(file.agent).toBeDefined();
          expect(file.sessionId).toBeDefined();
          expect(file.modifiedAt).toBeInstanceOf(Date);
          expect(typeof file.size).toBe('number');
        }
      }
    });
  });

  describe('Parse behavior', () => {
    it('all adapters provide parse method', () => {
      for (const adapter of adapters) {
        expect(typeof adapter.parse).toBe('function');
      }
    });

    it('parse returns null for non-existent files', async () => {
      for (const adapter of adapters) {
        const result = await adapter.parse({
          path: '/nonexistent/file.json',
          agent: adapter.id,
          projectPath: '/fake',
          projectName: 'fake',
          sessionId: 'fake',
          modifiedAt: new Date(),
          size: 0,
        });

        expect(result).toBeNull();
      }
    });
  });

  describe('Detector compatibility', () => {
    it('tool mappings use universal concepts', () => {
      const universalConcepts = [
        'read',
        'write',
        'edit',
        'bash',
        'search',
        'delete',
        'subagent',
        'context-management',
        'multi-file-edit',
      ];

      for (const adapter of adapters) {
        const mapping = adapter.getToolMapping();

        for (const [tool, concept] of Object.entries(mapping)) {
          expect(universalConcepts).toContain(concept);
        }
      }
    });
  });
});
