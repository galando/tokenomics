import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getActiveSessionTokens, checkBudget, renderBudgetDashboard, renderBudgetCheckOutput, sumTokensFromStream } from '../src/budget.js';
import type { BudgetConfig, BudgetCheckResult } from '../src/types.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tokenomics-budget-test-'));
}

function makeJsonlLine(type: string, inputTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type,
    message: {
      role: 'assistant',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    timestamp: new Date().toISOString(),
  });
}

const FIRED_ALERTS_PATH = join(homedir(), '.claude', 'tokenomics-alerts.json');

describe('budget', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    try { await unlink(FIRED_ALERTS_PATH); } catch { /* ok */ }
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    try { await unlink(FIRED_ALERTS_PATH); } catch { /* ok */ }
  });

  describe('getActiveSessionTokens', () => {
    it('returns 0 when no session files exist', async () => {
      const tokens = await getActiveSessionTokens(tempDir);
      expect(tokens).toBe(0);
    });

    it('reads tokens from active JSONL file', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      const lines = [
        makeJsonlLine('assistant', 1000, 500),
        makeJsonlLine('assistant', 2000, 1000),
        makeJsonlLine('assistant', 3000, 1500),
      ].join('\n');

      await writeFile(join(projectsDir, 'session-1.jsonl'), lines);

      const tokens = await getActiveSessionTokens(tempDir);
      expect(tokens).toBe(9000);
    });

    it('handles malformed lines gracefully', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      const lines = [
        makeJsonlLine('assistant', 1000, 500),
        'not valid json',
        makeJsonlLine('assistant', 2000, 1000),
        '',
      ].join('\n');

      await writeFile(join(projectsDir, 'session-1.jsonl'), lines);

      const tokens = await getActiveSessionTokens(tempDir);
      expect(tokens).toBe(4500);
    });

    it('picks the most recently modified file', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      await writeFile(
        join(projectsDir, 'old-session.jsonl'),
        makeJsonlLine('assistant', 50000, 50000)
      );

      await new Promise(r => setTimeout(r, 10));

      await writeFile(
        join(projectsDir, 'new-session.jsonl'),
        makeJsonlLine('assistant', 1000, 1000)
      );

      const tokens = await getActiveSessionTokens(tempDir);
      expect(tokens).toBe(2000);
    });
  });

  describe('checkBudget', () => {
    it('returns states for all three scopes', async () => {
      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const result = await checkBudget(config, tempDir);

      expect(result.states).toHaveLength(3);
      expect(result.states[0]!.scope).toBe('session');
      expect(result.states[1]!.scope).toBe('daily');
      expect(result.states[2]!.scope).toBe('project');
    });

    it('detects threshold crossing', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      // Use dense lines so tail-read captures them all within 8KB:
      // 10 lines * 26000 tokens = 260K = 52% of 500K
      const lines = Array(10)
        .fill(0)
        .map(() => makeJsonlLine('assistant', 13000, 13000))
        .join('\n');

      await writeFile(join(projectsDir, 'session.jsonl'), lines);

      const tokens = await getActiveSessionTokens(tempDir);
      expect(tokens).toBe(260_000);

      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const result = await checkBudget(config, tempDir);
      expect(result.states[0]!.percent).toBeGreaterThanOrEqual(50);
    });

    it('detects ceiling exceeded', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      // Dense lines: 20 lines * 26000 = 520K > 500K ceiling
      // 20 lines * ~230 bytes = ~4.6KB (well within 8KB tail-read)
      const lines = Array(20)
        .fill(0)
        .map(() => makeJsonlLine('assistant', 13000, 13000))
        .join('\n');

      await writeFile(join(projectsDir, 'session.jsonl'), lines);

      const tokens = await getActiveSessionTokens(tempDir);
      expect(tokens).toBe(520_000);

      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'downgrade',
      };

      const result = await checkBudget(config, tempDir);
      expect(result.ceilingExceeded).toBe(true);
      expect(result.exceededScope).toBe('session');
    });

    it('fires alerts exactly once per threshold', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      // 10 lines * 26000 = 260K = 52% of 500K (fits in tail-read)
      const lines = Array(10)
        .fill(0)
        .map(() => makeJsonlLine('assistant', 13000, 13000))
        .join('\n');

      await writeFile(join(projectsDir, 'session.jsonl'), lines);

      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      // First check should fire the 50% alert
      const result1 = await checkBudget(config, tempDir);
      const sessionAlerts1 = result1.newAlerts.filter(a => a.scope === 'session');
      expect(sessionAlerts1.length).toBeGreaterThanOrEqual(1);
      expect(sessionAlerts1.some(a => a.threshold === 50)).toBe(true);

      // Second check should NOT re-fire the 50% alert
      const result2 = await checkBudget(config, tempDir);
      const sessionAlerts2 = result2.newAlerts.filter(a => a.scope === 'session' && a.threshold === 50);
      expect(sessionAlerts2).toHaveLength(0);
    });

    it('suppresses alerts when muteAlerts is true', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      const lines = Array(10)
        .fill(0)
        .map(() => makeJsonlLine('assistant', 13000, 13000))
        .join('\n');

      await writeFile(join(projectsDir, 'session.jsonl'), lines);

      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
        muteAlerts: true,
      };

      const result = await checkBudget(config, tempDir);
      // Should still track state correctly
      expect(result.states[0]!.percent).toBeGreaterThanOrEqual(50);
      // But no alerts should fire
      expect(result.newAlerts).toHaveLength(0);
    });

    it('still detects ceiling exceeded when muted', async () => {
      const projectsDir = join(tempDir, 'projects', 'test-project');
      await mkdir(projectsDir, { recursive: true });

      const lines = Array(20)
        .fill(0)
        .map(() => makeJsonlLine('assistant', 13000, 13000))
        .join('\n');

      await writeFile(join(projectsDir, 'session.jsonl'), lines);

      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
        muteAlerts: true,
      };

      const result = await checkBudget(config, tempDir);
      expect(result.ceilingExceeded).toBe(true);
      expect(result.newAlerts).toHaveLength(0);
    });
  });

  describe('renderBudgetDashboard', () => {
    it('renders progress bars for all scopes', () => {
      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const states = [
        { scope: 'session' as const, used: 410_000, ceiling: 500_000, percent: 82 },
        { scope: 'daily' as const, used: 1_100_000, ceiling: 2_000_000, percent: 55 },
        { scope: 'project' as const, used: 3_200_000, ceiling: 10_000_000, percent: 32 },
      ];

      const output = renderBudgetDashboard(states, config);

      expect(output).toContain('SESSION');
      expect(output).toContain('DAILY');
      expect(output).toContain('PROJECT');
      expect(output).toContain('410,000');
      expect(output).toContain('500,000');
    });
  });

  describe('renderBudgetCheckOutput', () => {
    it('shows all clear when no alerts', () => {
      const result: BudgetCheckResult = {
        states: [
          { scope: 'session', used: 100_000, ceiling: 500_000, percent: 20 },
        ],
        newAlerts: [],
        ceilingExceeded: false,
      };

      const output = renderBudgetCheckOutput(result);
      expect(output).toContain('within limits');
    });

    it('shows ceiling exceeded', () => {
      const result: BudgetCheckResult = {
        states: [
          { scope: 'session', used: 500_000, ceiling: 500_000, percent: 100 },
        ],
        newAlerts: [],
        ceilingExceeded: true,
        exceededScope: 'session',
      };

      const output = renderBudgetCheckOutput(result);
      expect(output).toContain('ceiling exceeded');
      expect(output).toContain('session');
    });

    it('shows new alerts', () => {
      const result: BudgetCheckResult = {
        states: [
          { scope: 'session', used: 410_000, ceiling: 500_000, percent: 82 },
        ],
        newAlerts: [
          { scope: 'session', threshold: 80, timestamp: new Date().toISOString() },
        ],
        ceilingExceeded: false,
      };

      const output = renderBudgetCheckOutput(result);
      expect(output).toContain('80%');
    });
  });

  describe('checkBudget with CheckBudgetOptions', () => {
    it('dispatches via options object (no cache)', async () => {
      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const result = await checkBudget({ config, claudeDir: tempDir, forceRefresh: false });

      expect(result.states).toHaveLength(3);
      // No session files in tempDir → all zeros, no ceiling exceeded
      expect(result.ceilingExceeded).toBe(false);
      // No cache exists → daily and project should be in cachedScopes (session fallback)
      expect(result.cachedScopes).toBeDefined();
      expect(result.cachedScopes!.has('daily')).toBe(true);
      expect(result.cachedScopes!.has('project')).toBe(true);
    });

    it('forceRefresh path computes real totals', async () => {
      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const result = await checkBudget({ config, claudeDir: tempDir, forceRefresh: true });

      expect(result.states).toHaveLength(3);
      // forceRefresh writes cache → cachedScopes should be empty
      expect(result.cachedScopes).toBeDefined();
      expect(result.cachedScopes!.size).toBe(0);
    });
  });

  describe('sumTokensFromStream', () => {
    it('counts tokens from a JSONL file', async () => {
      const lines = [
        makeJsonlLine('assistant', 1000, 500),
        makeJsonlLine('assistant', 2000, 1000),
        makeJsonlLine('user', 500, 0),        // user messages are skipped
        makeJsonlLine('assistant', 3000, 1500),
        '',                                     // blank lines are skipped
        'not valid json',                       // malformed lines are skipped
      ].join('\n');

      const filePath = join(tempDir, 'test-session.jsonl');
      await writeFile(filePath, lines);

      const total = await sumTokensFromStream(filePath);
      // Only assistant lines: 1000+500 + 2000+1000 + 3000+1500 = 9000
      expect(total).toBe(9000);
    });

    it('returns 0 for empty file', async () => {
      const filePath = join(tempDir, 'empty.jsonl');
      await writeFile(filePath, '');

      const total = await sumTokensFromStream(filePath);
      expect(total).toBe(0);
    });
  });

  describe('renderBudgetDashboard with cachedScopes', () => {
    it('shows (cached) label for cached scopes', () => {
      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const states = [
        { scope: 'session' as const, used: 100_000, ceiling: 500_000, percent: 20 },
        { scope: 'daily' as const, used: 500_000, ceiling: 2_000_000, percent: 25 },
        { scope: 'project' as const, used: 2_000_000, ceiling: 10_000_000, percent: 20 },
      ];

      const cachedScopes = new Set(['daily', 'project'] as const);
      const output = renderBudgetDashboard(states, config, cachedScopes);

      // Session should NOT have (cached) label
      expect(output).toContain('SESSION: 20%');
      expect(output).not.toMatch(/SESSION:.*\(cached\)/);

      // Daily and project should have (cached) label
      expect(output).toContain('DAILY: 25% (cached)');
      expect(output).toContain('PROJECT: 20% (cached)');

      // Refresh hint should appear
      expect(output).toContain('tokenomics --budget');
    });

    it('hides refresh hint when no scopes are cached', () => {
      const config: BudgetConfig = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn',
      };

      const states = [
        { scope: 'session' as const, used: 100_000, ceiling: 500_000, percent: 20 },
        { scope: 'daily' as const, used: 500_000, ceiling: 2_000_000, percent: 25 },
        { scope: 'project' as const, used: 2_000_000, ceiling: 10_000_000, percent: 20 },
      ];

      const output = renderBudgetDashboard(states, config, new Set());
      expect(output).not.toContain('tokenomics --budget');
    });
  });
});
