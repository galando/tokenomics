/**
 * Tests for AgentAdapter types
 */

import { describe, it, expect } from 'vitest';
import type { AgentAdapter, AgentCapabilities, BestPractice, DiscoveredFile } from '../../src/agents/types.js';
import type { SessionData } from '../../src/types.js';

describe('AgentAdapter Types', () => {
  describe('AgentCapabilities', () => {
    it('should define all capability fields', () => {
      const capabilities: AgentCapabilities = {
        hasNativeTokenCounts: true,
        hasModelInfo: true,
        hasToolUsage: true,
        hasTimingData: true,
        configFormat: 'json',
      };

      expect(capabilities.hasNativeTokenCounts).toBe(true);
      expect(capabilities.configFormat).toBe('json');
    });
  });

  describe('BestPractice', () => {
    it('should define all best practice fields', () => {
      const practice: BestPractice = {
        id: 'use-compact',
        title: 'Use /compact',
        description: 'Use /compact to reset context',
        category: 'performance',
        severity: 'high',
      };

      expect(practice.id).toBe('use-compact');
      expect(practice.category).toBe('performance');
      expect(practice.severity).toBe('high');
    });

    it('should allow optional detectFn', () => {
      const practice: BestPractice = {
        id: 'use-compact',
        title: 'Use /compact',
        description: 'Use /compact to reset context',
        category: 'performance',
        severity: 'high',
        detectFn: (session: SessionData) => session.compactUsed,
      };

      expect(practice.detectFn).toBeDefined();
      expect(typeof practice.detectFn).toBe('function');
    });
  });

  describe('DiscoveredFile', () => {
    it('should include agent field', () => {
      const file: DiscoveredFile = {
        path: '/path/to/session.jsonl',
        agent: 'claude-code',
        projectPath: '/path/to/project',
        projectName: 'my-project',
        sessionId: 'abc123',
        modifiedAt: new Date(),
        size: 1024,
      };

      expect(file.agent).toBe('claude-code');
    });

    it('should allow optional metadata', () => {
      const file: DiscoveredFile = {
        path: '/path/to/session.jsonl',
        agent: 'claude-code',
        projectPath: '/path/to/project',
        projectName: 'my-project',
        sessionId: 'abc123',
        modifiedAt: new Date(),
        size: 1024,
        metadata: {
          source: 'main-session',
        },
      };

      expect(file.metadata?.source).toBe('main-session');
    });
  });

  describe('AgentAdapter interface', () => {
    it('should require all methods', () => {
      const adapter: AgentAdapter = {
        id: 'test-agent',
        name: 'Test Agent',
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

      expect(adapter.id).toBe('test-agent');
      expect(adapter.name).toBe('Test Agent');
      expect(typeof adapter.detect).toBe('function');
      expect(typeof adapter.discover).toBe('function');
      expect(typeof adapter.parse).toBe('function');
      expect(typeof adapter.getConfigPaths).toBe('function');
      expect(typeof adapter.getBestPractices).toBe('function');
      expect(typeof adapter.getToolMapping).toBe('function');
    });
  });

  describe('SessionData agent field', () => {
    it('should include agent field as required', () => {
      const session: SessionData = {
        id: 'test-session',
        agent: 'claude-code',
        project: 'test-project',
        projectPath: '/path/to/project',
        slug: 'test-slug',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        toolUses: [],
        toolResults: [],
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        turnCount: 5,
        compactUsed: false,
        compactCount: 0,
        startedAt: '2025-01-01T00:00:00Z',
        endedAt: '2025-01-01T00:05:00Z',
        sourceFile: '/path/to/session.jsonl',
      };

      expect(session.agent).toBe('claude-code');
    });

    it('should include optional agent metadata fields', () => {
      const session: SessionData = {
        id: 'test-session',
        agent: 'claude-code',
        agentVersion: '1.0.0',
        rawTokenCounts: true,
        project: 'test-project',
        projectPath: '/path/to/project',
        slug: 'test-slug',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        toolUses: [],
        toolResults: [],
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        turnCount: 5,
        compactUsed: false,
        compactCount: 0,
        startedAt: '2025-01-01T00:00:00Z',
        endedAt: '2025-01-01T00:05:00Z',
        sourceFile: '/path/to/session.jsonl',
      };

      expect(session.agentVersion).toBe('1.0.0');
      expect(session.rawTokenCounts).toBe(true);
    });
  });
});
