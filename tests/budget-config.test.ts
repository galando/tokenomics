import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBudgetConfig, writeBudgetConfig, ensureBudgetConfig, DEFAULT_BUDGET } from '../src/budget-config.js';

describe('budget-config', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tokenomics-budget-test-'));
    configPath = join(tempDir, 'tokenomics.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('readBudgetConfig', () => {
    it('returns defaults when no file exists', async () => {
      const result = await readBudgetConfig(configPath);
      expect(result).toEqual(DEFAULT_BUDGET);
    });

    it('reads existing config and preserves values', async () => {
      const customConfig = {
        sessionCeiling: 1_000_000,
        dailyCeiling: 5_000_000,
        projectCeiling: 20_000_000,
        alertThresholds: [40, 70, 95],
        ceilingAction: 'downgrade' as const,
      };
      await writeFile(configPath, JSON.stringify(customConfig));

      const result = await readBudgetConfig(configPath);
      expect(result.sessionCeiling).toBe(1_000_000);
      expect(result.dailyCeiling).toBe(5_000_000);
      expect(result.projectCeiling).toBe(20_000_000);
      expect(result.alertThresholds).toEqual([40, 70, 95]);
      expect(result.ceilingAction).toBe('downgrade');
    });

    it('merges partial config with defaults', async () => {
      const partialConfig = {
        sessionCeiling: 750_000,
        // Other fields should use defaults
      };
      await writeFile(configPath, JSON.stringify(partialConfig));

      const result = await readBudgetConfig(configPath);
      expect(result.sessionCeiling).toBe(750_000);
      expect(result.dailyCeiling).toBe(DEFAULT_BUDGET.dailyCeiling);
      expect(result.alertThresholds).toEqual(DEFAULT_BUDGET.alertThresholds);
      expect(result.ceilingAction).toBe(DEFAULT_BUDGET.ceilingAction);
    });

    it('handles invalid JSON gracefully', async () => {
      await writeFile(configPath, '{ invalid json }');
      const result = await readBudgetConfig(configPath);
      expect(result).toEqual(DEFAULT_BUDGET);
    });
  });

  describe('writeBudgetConfig', () => {
    it('writes config with proper formatting', async () => {
      const config = {
        sessionCeiling: 500_000,
        dailyCeiling: 2_000_000,
        projectCeiling: 10_000_000,
        alertThresholds: [50, 80, 90],
        ceilingAction: 'warn' as const,
      };

      await writeBudgetConfig(config, configPath);

      const result = await readBudgetConfig(configPath);
      expect(result.sessionCeiling).toBe(500_000);
      expect(result.ceilingAction).toBe('warn');
    });

    it('creates parent directories if needed', async () => {
      const nestedPath = join(tempDir, 'nested', 'dir', 'config.json');
      const config = { ...DEFAULT_BUDGET };

      await writeBudgetConfig(config, nestedPath);

      const result = await readBudgetConfig(nestedPath);
      expect(result).toEqual(DEFAULT_BUDGET);
    });
  });

  describe('ensureBudgetConfig', () => {
    it('creates config with defaults when file does not exist', async () => {
      const result = await ensureBudgetConfig(configPath);

      expect(result.config).toEqual(DEFAULT_BUDGET);
      expect(result.created).toBe(true);

      // Verify file was created
      const read = await readBudgetConfig(configPath);
      expect(read).toEqual(DEFAULT_BUDGET);
    });

    it('returns existing config when file exists', async () => {
      // First call creates the config
      const first = await ensureBudgetConfig(configPath);
      expect(first.created).toBe(true);

      // Second call should find the existing config
      const second = await ensureBudgetConfig(configPath);
      expect(second.created).toBe(false);
      expect(second.config).toEqual(first.config);
    });

    it('preserves custom values on subsequent calls', async () => {
      const customConfig = {
        ...DEFAULT_BUDGET,
        sessionCeiling: 999_999,
      };

      await writeBudgetConfig(customConfig, configPath);

      const result = await ensureBudgetConfig(configPath);
      expect(result.created).toBe(false);
      expect(result.config.sessionCeiling).toBe(999_999);
      expect(result.config.alertThresholds).toEqual(DEFAULT_BUDGET.alertThresholds);
    });
  });

  describe('config round-trip', () => {
    it('maintains data integrity through write -> read cycle', async () => {
      const original = {
        sessionCeiling: 1_500_000,
        dailyCeiling: 7_500_000,
        projectCeiling: 30_000_000,
        alertThresholds: [33, 66, 99],
        ceilingAction: 'pause' as const,
      };

      await writeBudgetConfig(original, configPath);
      const restored = await readBudgetConfig(configPath);

      expect(restored).toEqual(original);
    });

    it('handles all ceiling action types', async () => {
      const actions: Array<'downgrade' | 'pause' | 'warn'> = ['downgrade', 'pause', 'warn'];

      for (const action of actions) {
        const config = { ...DEFAULT_BUDGET, ceilingAction: action };
        await writeBudgetConfig(config, configPath);
        const read = await readBudgetConfig(configPath);
        expect(read.ceilingAction).toBe(action);
      }
    });

    it('preserves threshold array order', async () => {
      const thresholds = [25, 50, 75, 90, 95];
      const config = { ...DEFAULT_BUDGET, alertThresholds: thresholds };

      await writeBudgetConfig(config, configPath);
      const read = await readBudgetConfig(configPath);

      expect(read.alertThresholds).toEqual(thresholds);
    });
  });
});
