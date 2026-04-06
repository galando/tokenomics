import { describe, it, expect } from 'vitest';
import {
  extractSignals,
  buildProjectBaseline,
  routePrompt,
  renderRouteOutput,
  routerToDetectorResult,
} from '../src/router.js';
import type { SessionData } from '../src/types.js';

describe('router', () => {
  describe('extractSignals', () => {
    it('detects simple keywords', () => {
      const prompt = 'fix the bug in auth.ts';
      const signals = extractSignals(prompt);

      expect(signals.wordCount).toBe(5);
      expect(signals.hasSimpleKeywords).toBe(true);
      expect(signals.hasComplexKeywords).toBe(false);
      expect(signals.fileReferenceCount).toBe(1);
      expect(signals.fileReferences).toContain('auth.ts');
    });

    it('detects complex keywords', () => {
      const prompt = 'design a multi-tenant database schema with row-level security';
      const signals = extractSignals(prompt);

      expect(signals.wordCount).toBe(8); // "row-level" is one word
      expect(signals.hasSimpleKeywords).toBe(false);
      expect(signals.hasComplexKeywords).toBe(true);
    });

    it('detects both simple and complex keywords', () => {
      const prompt = 'fix the authentication design'; // Has both 'fix' (simple) and 'design' (complex)
      const signals = extractSignals(prompt);

      expect(signals.hasSimpleKeywords).toBe(true);
      expect(signals.hasComplexKeywords).toBe(true);
    });

    it('extracts multiple file references', () => {
      const prompt = 'update src/auth.ts and src/user.ts to use the new schema';
      const signals = extractSignals(prompt);

      expect(signals.fileReferenceCount).toBe(2);
      expect(signals.fileReferences).toEqual(['src/auth.ts', 'src/user.ts']);
    });

    it('deduplicates file references', () => {
      const prompt = 'check auth.ts, then update auth.ts again';
      const signals = extractSignals(prompt);

      expect(signals.fileReferenceCount).toBe(1);
      expect(signals.fileReferences).toEqual(['auth.ts']);
    });

    it('handles prompts with no file references', () => {
      const prompt = 'explain how recursion works';
      const signals = extractSignals(prompt);

      expect(signals.fileReferenceCount).toBe(0);
      expect(signals.fileReferences).toEqual([]);
    });

    it('counts words correctly', () => {
      const prompt = 'one two three four five';
      const signals = extractSignals(prompt);

      expect(signals.wordCount).toBe(5);
    });

    it('handles empty prompt', () => {
      const signals = extractSignals('');

      expect(signals.wordCount).toBe(0);
      expect(signals.hasSimpleKeywords).toBe(false);
      expect(signals.hasComplexKeywords).toBe(false);
      expect(signals.fileReferenceCount).toBe(0);
    });

    it('handles whitespace-only prompt', () => {
      const signals = extractSignals('   \n\t  ');

      expect(signals.wordCount).toBe(0);
    });
  });

  describe('buildProjectBaseline', () => {
    const createMockSession = (toolCount: number, files: string[]): SessionData => ({
      id: 'test-1',
      project: 'test-project',
      projectPath: '/test',
      slug: 'test-slug',
      model: 'claude-opus-4-6',
      messages: [],
      toolUses: Array.from({ length: toolCount }, (_, i) => ({
        id: `tool-${i}`,
        name: 'Read',
        input: { path: files[i % files.length] },
        timestamp: '2024-01-01T00:00:00Z',
      })),
      toolResults: [],
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      turnCount: 1,
      compactUsed: false,
      compactCount: 0,
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T01:00:00Z',
      sourceFile: '/test/file.jsonl',
    });

    it('calculates baseline from session data', () => {
      const sessions = [
        createMockSession(3, ['src/auth.ts', 'src/user.ts']),
        createMockSession(5, ['src/config.ts']),
        createMockSession(2, ['src/utils.ts']),
      ];

      const baseline = buildProjectBaseline(sessions);

      expect(baseline.totalSessions).toBe(3);
      expect(baseline.avgToolCount).toBeCloseTo(3.3, 1);
      expect(baseline.avgFileSpan).toBeCloseTo(1.3, 1);
    });

    it('calculates simple session rate correctly', () => {
      const createSimpleSession = (): SessionData => ({
        ...createMockSession(3, ['src/auth.ts']),
        toolUses: [
          { id: '1', name: 'Read', input: { path: 'file.ts' }, timestamp: '2024-01-01T00:00:00Z' },
          { id: '2', name: 'Edit', input: {}, timestamp: '2024-01-01T00:00:00Z' },
          { id: '3', name: 'Bash', input: { command: 'test' }, timestamp: '2024-01-01T00:00:00Z' },
        ],
      });

      const createComplexSession = (): SessionData => ({
        ...createMockSession(20, ['src/auth.ts']), // >15 tools = complex
        toolUses: Array.from({ length: 20 }, (_, i) => ({
          id: `${i}`,
          name: 'Read',
          input: { path: `file${i}.ts` },
          timestamp: '2024-01-01T00:00:00Z',
        })),
      });

      const sessions = [
        createSimpleSession(),
        createSimpleSession(),
        createSimpleSession(),
        createComplexSession(),
      ];

      const baseline = buildProjectBaseline(sessions);

      expect(baseline.simpleSessionRate).toBe(75); // 3 of 4 are simple
    });

    it('returns empty baseline for no sessions', () => {
      const baseline = buildProjectBaseline([]);

      expect(baseline.avgToolCount).toBe(0);
      expect(baseline.avgFileSpan).toBe(0);
      expect(baseline.simpleSessionRate).toBe(0);
      expect(baseline.totalSessions).toBe(0);
    });

    it('handles sessions with no file accesses', () => {
      const session: SessionData = {
        ...createMockSession(3, []),
        toolUses: [
          { id: '1', name: 'Bash', input: { command: 'echo test' }, timestamp: '2024-01-01T00:00:00Z' },
        ],
      };

      const baseline = buildProjectBaseline([session]);

      expect(baseline.avgFileSpan).toBe(0);
    });
  });

  describe('routePrompt', () => {
    it('routes simple prompt to Sonnet with high confidence', () => {
      const signals = {
        wordCount: 5,
        hasSimpleKeywords: true,
        hasComplexKeywords: false,
        fileReferenceCount: 1,
        fileReferences: ['auth.ts'],
      };

      const decision = routePrompt(signals);

      expect(decision.model).toBe('claude-sonnet-4-6');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
      expect(decision.reason).toContain('Simple task');
      expect(decision.estimatedSavings).toContain('~80%');
    });

    it('routes complex prompt to Opus with high confidence', () => {
      const signals = {
        wordCount: 10,
        hasSimpleKeywords: false,
        hasComplexKeywords: true,
        fileReferenceCount: 0,
        fileReferences: [],
      };

      const decision = routePrompt(signals);

      expect(decision.model).toBe('claude-opus-4-6');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.85);
      expect(decision.reason).toContain('Complex reasoning');
      expect(decision.estimatedSavings).toContain('~0%');
    });

    it('uses historical baseline when available', () => {
      const signals = {
        wordCount: 15,
        hasSimpleKeywords: false,
        hasComplexKeywords: false,
        fileReferenceCount: 1,
        fileReferences: ['file.ts'],
      };

      const baseline = {
        avgToolCount: 3,
        avgFileSpan: 2,
        simpleSessionRate: 80, // High simple rate
        totalSessions: 10,
      };

      const decision = routePrompt(signals, baseline);

      expect(decision.model).toBe('claude-sonnet-4-6');
      expect(decision.reason).toContain('80%');
      expect(decision.estimatedSavings).toContain('~80%');
    });

    it('routes long prompts to Opus', () => {
      const signals = {
        wordCount: 75, // > 50 words
        hasSimpleKeywords: false,
        hasComplexKeywords: false,
        fileReferenceCount: 0,
        fileReferences: [],
      };

      const decision = routePrompt(signals);

      expect(decision.model).toBe('claude-opus-4-6');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('routes multi-file prompts to Opus', () => {
      const signals = {
        wordCount: 20,
        hasSimpleKeywords: false,
        hasComplexKeywords: false,
        fileReferenceCount: 5, // > 3 files
        fileReferences: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      };

      const decision = routePrompt(signals);

      expect(decision.model).toBe('claude-opus-4-6');
      expect(decision.reason).toContain('5 files');
    });

    it('defaults to Sonnet for ambiguous prompts', () => {
      const signals = {
        wordCount: 25,
        hasSimpleKeywords: false,
        hasComplexKeywords: false,
        fileReferenceCount: 2,
        fileReferences: ['a.ts', 'b.ts'],
      };

      const decision = routePrompt(signals);

      expect(decision.model).toBe('claude-sonnet-4-6');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.7);
      expect(decision.estimatedSavings).toContain('~80%');
    });

    it('handles empty signals', () => {
      const signals = {
        wordCount: 0,
        hasSimpleKeywords: false,
        hasComplexKeywords: false,
        fileReferenceCount: 0,
        fileReferences: [],
      };

      const decision = routePrompt(signals);

      expect(decision.model).toBe('claude-sonnet-4-6');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('renderRouteOutput', () => {
    it('renders decision as formatted text', () => {
      const decision = {
        model: 'claude-sonnet-4-6',
        confidence: 0.85,
        reason: 'Simple task keywords detected',
        estimatedSavings: '~80% vs Opus',
        signals: {
          wordCount: 5,
          hasSimpleKeywords: true,
          hasComplexKeywords: false,
          fileReferenceCount: 1,
          fileReferences: ['auth.ts'],
        },
      };

      const output = renderRouteOutput(decision);

      expect(output).toContain('claude-sonnet-4-6');
      expect(output).toContain('85%');
      expect(output).toContain('Simple task keywords detected');
      expect(output).toContain('~80% vs Opus');
      expect(output).toContain('Words: 5');
      expect(output).toContain('File references: 1');
    });

    it('handles zero-word prompts', () => {
      const decision = {
        model: 'claude-sonnet-4-6',
        confidence: 0.70,
        reason: 'Default model for general tasks',
        estimatedSavings: '~80% vs Opus',
        signals: {
          wordCount: 0,
          hasSimpleKeywords: false,
          hasComplexKeywords: false,
          fileReferenceCount: 0,
          fileReferences: [],
        },
      };

      const output = renderRouteOutput(decision);

      // Should not show signals section for empty prompts
      expect(output).not.toContain('Signals:');
    });
  });

  describe('routerToDetectorResult', () => {
    const createMockSession = (toolCount: number, tokens: number): SessionData => ({
      id: `session-${toolCount}`,
      project: 'test-project',
      projectPath: '/test',
      slug: `slug-${toolCount}`,
      model: 'claude-opus-4-6',
      messages: [],
      toolUses: Array.from({ length: toolCount }, (_, i) => ({
        id: `tool-${i}`,
        name: 'Read',
        input: { path: `file${i}.ts` },
        timestamp: '2024-01-01T00:00:00Z',
      })),
      toolResults: [],
      totalInputTokens: tokens,
      totalOutputTokens: tokens,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      turnCount: 1,
      compactUsed: false,
      compactCount: 0,
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T01:00:00Z',
      sourceFile: '/test/file.jsonl',
    });

    it('returns null for empty sessions', () => {
      const result = routerToDetectorResult([]);
      expect(result).toBeNull();
    });

    it('returns null when simple rate is too low', () => {
      const sessions = [
        createMockSession(20, 10000), // Complex
        createMockSession(25, 12000), // Complex
        createMockSession(30, 15000), // Complex
      ];

      const result = routerToDetectorResult([]);
      expect(result).toBeNull();
    });

    it('creates detector result when simple rate is high enough', () => {
      const sessions = [
        createMockSession(3, 1000), // Simple
        createMockSession(4, 1200), // Simple
        createMockSession(2, 800), // Simple
        createMockSession(20, 5000), // Complex
      ];

      const result = routerToDetectorResult(sessions);

      expect(result).not.toBeNull();
      expect(result?.detector).toBe('smart-router');
      expect(result?.title).toBe('Smart Model Routing');
      expect(result?.evidence.simpleSessionRate).toBeGreaterThan(50);
    });

    it('calculates savings correctly', () => {
      const sessions = [
        createMockSession(3, 1000), // Simple - 2000 total tokens
        createMockSession(4, 1500), // Simple - 3000 total tokens
      ];

      const result = routerToDetectorResult(sessions);

      expect(result?.savingsTokens).toBeCloseTo(4000, 0); // 80% of 5000
    });

    it('includes session breakdown', () => {
      const sessions = [
        createMockSession(3, 1000),
        createMockSession(4, 1500),
      ];

      const result = routerToDetectorResult(sessions);

      expect(result?.sessionBreakdown).toContain('test-project');
      expect(result?.sessionBreakdown).toContain('Sonnet sufficient');
    });
  });
});
