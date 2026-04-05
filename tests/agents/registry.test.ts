/**
 * Tests for agent adapter registry
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerAdapter,
  getAdapters,
  getAdapter,
  detectInstalledAgents,
  discoverAllFiles,
  discoverFilesByAgents,
  initializeDefaultAdapters,
} from '../../src/agents/registry.js';
import type { AgentAdapter } from '../../src/agents/types.js';
import { claudeCodeAdapter } from '../../src/agents/claude-code.js';

describe('Agent Registry', () => {
  let mockAdapter: AgentAdapter;

  beforeEach(() => {
    // Initialize default adapters before each test
    initializeDefaultAdapters();

    mockAdapter = {
      id: 'mock-agent',
      name: 'Mock Agent',
      capabilities: {
        hasNativeTokenCounts: true,
        hasModelInfo: true,
        hasToolUsage: true,
        hasTimingData: true,
        configFormat: 'json',
      },
      detect: async () => true,
      discover: async () => [],
      parse: async () => null,
      getConfigPaths: async () => [],
      getBestPractices: () => [],
      getToolMapping: () => ({}),
    };
  });

  afterEach(() => {
    // Clear mock adapters after each test
    // Note: Claude Code adapter is registered by default
  });

  describe('registerAdapter()', () => {
    it('should register an adapter', () => {
      const beforeCount = getAdapters().length;
      registerAdapter(mockAdapter);
      const afterCount = getAdapters().length;

      expect(afterCount).toBe(beforeCount + 1);
    });

    it('should not duplicate adapters with same ID', () => {
      registerAdapter(mockAdapter);
      registerAdapter(mockAdapter);

      const adapters = getAdapters();
      const mockCount = adapters.filter((a) => a.id === 'mock-agent').length;

      expect(mockCount).toBe(1);
    });
  });

  describe('getAdapters()', () => {
    it('should return all registered adapters', () => {
      registerAdapter(mockAdapter);

      const adapters = getAdapters();
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.some((a) => a.id === 'claude-code')).toBe(true);
    });

    it('should include Claude Code adapter by default', () => {
      const adapters = getAdapters();
      expect(adapters.some((a) => a.id === 'claude-code')).toBe(true);
    });
  });

  describe('getAdapter()', () => {
    it('should get adapter by ID', () => {
      registerAdapter(mockAdapter);

      const adapter = getAdapter('mock-agent');
      expect(adapter).toBeDefined();
      expect(adapter?.id).toBe('mock-agent');
    });

    it('should return undefined for unknown adapter', () => {
      const adapter = getAdapter('unknown-agent');
      expect(adapter).toBeUndefined();
    });

    it('should get Claude Code adapter', () => {
      const adapter = getAdapter('claude-code');
      expect(adapter).toBeDefined();
      expect(adapter?.id).toBe('claude-code');
    });
  });

  describe('detectInstalledAgents()', () => {
    it('should detect installed agents', async () => {
      const detected = await detectInstalledAgents();

      expect(Array.isArray(detected)).toBe(true);
      // At minimum, Claude Code should be detected if installed
    });

    it('should call detect() on each adapter', async () => {
      const detectSpy = vi.spyOn(mockAdapter, 'detect');
      registerAdapter(mockAdapter);

      await detectInstalledAgents();

      expect(detectSpy).toHaveBeenCalled();
    });
  });

  describe('discoverAllFiles()', () => {
    it('should discover files from all detected agents', async () => {
      const files = await discoverAllFiles({ days: 30 });

      expect(Array.isArray(files)).toBe(true);
      // Each file should have required fields
      for (const file of files) {
        expect(file.agent).toBeDefined();
        expect(file.path).toBeDefined();
        expect(file.sessionId).toBeDefined();
        expect(file.modifiedAt).toBeInstanceOf(Date);
      }
    });

    it('should sort files by modification date', async () => {
      const files = await discoverAllFiles({ days: 30 });

      if (files.length > 1) {
        for (let i = 0; i < files.length - 1; i++) {
          expect(files[i].modifiedAt.getTime() >= files[i + 1].modifiedAt.getTime()).toBe(true);
        }
      }
    });
  });

  describe('discoverFilesByAgents()', () => {
    it('should discover files from specific agents', async () => {
      const files = await discoverFilesByAgents(['claude-code'], { days: 30 });

      expect(Array.isArray(files)).toBe(true);
      for (const file of files) {
        expect(file.agent).toBe('claude-code');
      }
    });

    it('should handle unknown agent IDs gracefully', async () => {
      const files = await discoverFilesByAgents(['unknown-agent'], { days: 30 });

      expect(files).toEqual([]);
    });

    it('should handle multiple agent IDs', async () => {
      registerAdapter(mockAdapter);

      const files = await discoverFilesByAgents(
        ['claude-code', 'mock-agent'],
        { days: 30 }
      );

      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('initializeDefaultAdapters()', () => {
    it('should initialize Claude Code adapter', () => {
      // Initialize adapters
      initializeDefaultAdapters();

      const adapters = getAdapters();
      expect(adapters.some((a) => a.id === 'claude-code')).toBe(true);
    });
  });
});
