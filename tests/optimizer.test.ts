import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DetectorResult } from '../src/types.js';
import { isAutoFixable, optimizeSettings, applySettings } from '../src/optimizer.js';

const originalHome = process.env.HOME;

function makeFinding(detector: string, confidence: number = 0.8, evidence: Record<string, unknown> = {}): DetectorResult {
  return {
    detector,
    title: `Test ${detector}`,
    severity: 'medium',
    savingsPercent: 5,
    savingsTokens: 50000,
    confidence,
    evidence,
    remediation: {
      problem: 'test',
      whyItMatters: 'test',
      steps: [],
      examples: [],
      quickWin: 'test',
      specificQuickWin: 'test',
      effort: 'quick',
    },
    sessionBreakdown: '',
  };
}

describe('optimizer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tokenomics-opt-'));
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('isAutoFixable', () => {
    it('returns true for model-selection', () => {
      expect(isAutoFixable('model-selection')).toBe(true);
    });

    it('returns true for mcp-tool-tax', () => {
      expect(isAutoFixable('mcp-tool-tax')).toBe(true);
    });

    it('returns false for other detectors', () => {
      expect(isAutoFixable('context-snowball')).toBe(false);
      expect(isAutoFixable('vague-prompts')).toBe(false);
      expect(isAutoFixable('bash-output-bloat')).toBe(false);
    });
  });

  describe('optimizeSettings', () => {
    it('generates model-default suggestion from model-selection finding', () => {
      const findings = [makeFinding('model-selection', 0.8, { overkillRate: 0.4 })];
      const changes = optimizeSettings(findings);

      expect(changes).toHaveLength(1);
      expect(changes[0]!.type).toBe('model-default');
      expect(changes[0]!.suggested).toBe('claude-sonnet-4-6');
      expect(changes[0]!.reason).toContain('40%');
    });

    it('generates mcp-server-remove suggestion from mcp-tool-tax finding', () => {
      const findings = [makeFinding('mcp-tool-tax', 0.8, { neverUsedServers: ['server-a', 'server-b'] })];
      const changes = optimizeSettings(findings);

      expect(changes).toHaveLength(1);
      expect(changes[0]!.type).toBe('mcp-server-remove');
      expect(changes[0]!.current).toContain('server-a');
    });

    it('does not suggest for low confidence findings', () => {
      const findings = [makeFinding('model-selection', 0.3, { overkillRate: 0.4 })];
      const changes = optimizeSettings(findings);
      expect(changes).toHaveLength(0);
    });

    it('returns empty for non-auto-fixable detectors', () => {
      const findings = [makeFinding('context-snowball', 0.9)];
      const changes = optimizeSettings(findings);
      expect(changes).toHaveLength(0);
    });
  });

  describe('applySettings', () => {
    it('with dryRun=true returns applied: false', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus' }, null, 2),
      );

      const changes = [{
        type: 'model-default' as const,
        file: '~/.claude/settings.json',
        current: 'opus',
        suggested: 'claude-sonnet-4-6',
        reason: 'test',
        confidence: 0.8,
      }];

      const results = await applySettings(changes, true);
      expect(results).toHaveLength(1);
      expect(results[0]!.applied).toBe(false);
    });

    it('with dryRun=false applies and returns applied: true', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus' }, null, 2),
      );

      const changes = [{
        type: 'model-default' as const,
        file: '~/.claude/settings.json',
        current: 'opus',
        suggested: 'claude-sonnet-4-6',
        reason: 'test',
        confidence: 0.8,
      }];

      const results = await applySettings(changes, false);
      expect(results).toHaveLength(1);
      expect(results[0]!.applied).toBe(true);
    });

    it('skips when model is already sonnet/haiku', async () => {
      await mkdir(join(tempDir, '.claude'), { recursive: true });
      await writeFile(
        join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({ model: 'claude-sonnet-4-6' }, null, 2),
      );

      const changes = [{
        type: 'model-default' as const,
        file: '~/.claude/settings.json',
        current: 'sonnet',
        suggested: 'claude-sonnet-4-6',
        reason: 'test',
        confidence: 0.8,
      }];

      const results = await applySettings(changes, false);
      expect(results[0]!.applied).toBe(false);
    });
  });
});
