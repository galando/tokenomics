import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DetectorResult } from '../src/types.js';
import { findingsToInstructions, renderInstructionBlock, injectFindings } from '../src/injector.js';

function makeFinding(overrides: Partial<DetectorResult> & { detector: string }): DetectorResult {
  return {
    detector: overrides.detector,
    title: overrides.title ?? 'Test Finding',
    severity: overrides.severity ?? 'medium',
    savingsPercent: overrides.savingsPercent ?? 5,
    savingsTokens: overrides.savingsTokens ?? 50000,
    confidence: overrides.confidence ?? 0.8,
    evidence: overrides.evidence ?? {},
    remediation: overrides.remediation ?? {
      problem: 'test',
      whyItMatters: 'test',
      steps: [],
      examples: [],
      quickWin: 'test',
      specificQuickWin: 'test',
      effort: 'quick',
    },
    sessionBreakdown: overrides.sessionBreakdown ?? '',
  };
}

describe('injector', () => {
  describe('findingsToInstructions', () => {
    it('generates behavioral-coaching for context-snowball', () => {
      const findings = [makeFinding({
        detector: 'context-snowball',
        evidence: { avgInflectionTurn: 8, snowballRate: 60 },
      })];

      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(1);
      expect(instructions[0]!.category).toBe('behavioral-coaching');
      expect(instructions[0]!.instruction).toContain('/compact');
      expect(instructions[0]!.instruction).toContain('turn 8');
    });

    it('generates model-recommendation for model-selection', () => {
      const findings = [makeFinding({
        detector: 'model-selection',
        evidence: { overkillRate: 40 },
      })];

      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(1);
      expect(instructions[0]!.category).toBe('model-recommendation');
      expect(instructions[0]!.instruction).toContain('Sonnet');
      expect(instructions[0]!.instruction).toContain('40%');
    });

    it('generates prompt-improvement for vague-prompts', () => {
      const findings = [makeFinding({
        detector: 'vague-prompts',
        evidence: { vagueRate: 35 },
      })];

      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(1);
      expect(instructions[0]!.category).toBe('prompt-improvement');
      expect(instructions[0]!.instruction).toContain('35%');
      expect(instructions[0]!.instruction).toContain('file paths');
    });

    it('generates instructions for all supported detectors', () => {
      const findings = [
        makeFinding({ detector: 'context-snowball' }),
        makeFinding({ detector: 'model-selection' }),
        makeFinding({ detector: 'vague-prompts' }),
        makeFinding({ detector: 'bash-output-bloat' }),
        makeFinding({ detector: 'file-read-waste' }),
        makeFinding({ detector: 'mcp-tool-tax', evidence: { neverUsedServers: ['server-a'] } }),
        makeFinding({ detector: 'subagent-opportunity' }),
        makeFinding({ detector: 'session-timing' }),
        makeFinding({ detector: 'claude-md-overhead', savingsPercent: 5 }),
      ];

      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(9);
    });

    it('filters out findings with confidence < 0.3', () => {
      const findings = [
        makeFinding({ detector: 'context-snowball', confidence: 0.2 }),
        makeFinding({ detector: 'model-selection', confidence: 0.8 }),
      ];

      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(1);
      expect(instructions[0]!.sourceDetector).toBe('model-selection');
    });

    it('returns empty for empty findings', () => {
      const instructions = findingsToInstructions([]);
      expect(instructions).toHaveLength(0);
    });

    it('returns null for mcp-tool-tax with no unused servers', () => {
      const findings = [makeFinding({ detector: 'mcp-tool-tax', evidence: { neverUsedServers: [] } })];
      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(0);
    });

    it('returns null for claude-md-overhead with 0% savings', () => {
      const findings = [makeFinding({ detector: 'claude-md-overhead', savingsPercent: 0 })];
      const instructions = findingsToInstructions(findings);
      expect(instructions).toHaveLength(0);
    });
  });

  describe('renderInstructionBlock', () => {
    it('produces valid markdown with markers', () => {
      const instructions = [
        { category: 'behavioral-coaching' as const, instruction: 'Use /compact', sourceDetector: 'test', confidence: 0.8 },
      ];

      const rendered = renderInstructionBlock(instructions);
      expect(rendered).toContain('Token Optimization Insights');
      expect(rendered).toContain('Use /compact');
    });

    it('returns minimal message for empty instructions', () => {
      const rendered = renderInstructionBlock([]);
      expect(rendered).toBe('No optimization opportunities detected.');
    });

    it('groups instructions by category', () => {
      const instructions = [
        { category: 'model-recommendation' as const, instruction: 'Use Sonnet', sourceDetector: 'test1', confidence: 0.8 },
        { category: 'behavioral-coaching' as const, instruction: 'Use /compact', sourceDetector: 'test2', confidence: 0.7 },
        { category: 'model-recommendation' as const, instruction: 'Remove MCP', sourceDetector: 'test3', confidence: 0.9 },
      ];

      const rendered = renderInstructionBlock(instructions);
      expect(rendered).toContain('### Model Usage');
      expect(rendered).toContain('### Context Management');
    });

    it('includes last updated date', () => {
      const instructions = [
        { category: 'general' as const, instruction: 'test', sourceDetector: 'test', confidence: 0.5 },
      ];

      const rendered = renderInstructionBlock(instructions);
      const today = new Date().toISOString().slice(0, 10);
      expect(rendered).toContain(today);
    });
  });

  describe('injectFindings', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'tokenomics-inject-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('creates CLAUDE.md if missing', async () => {
      const projectDir = tempDir;
      const findings = [makeFinding({ detector: 'context-snowball' })];

      const result = await injectFindings(findings, projectDir);
      expect(result.changed).toBe(true);

      // Check project CLAUDE.md was created
      const claudeMdPath = join(projectDir, '.claude', 'CLAUDE.md');
      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('TOKENOMICS:START');
      expect(content).toContain('/compact');
    });

    it('preserves content outside markers', async () => {
      const projectDir = tempDir;
      const claudeMdDir = join(projectDir, '.claude');

      // Create existing CLAUDE.md
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(claudeMdDir, { recursive: true });
      const existingContent = '# My Rules\nAlways use TypeScript.\n';
      await writeFile(join(claudeMdDir, 'CLAUDE.md'), existingContent, 'utf-8');

      const findings = [makeFinding({ detector: 'model-selection', evidence: { overkillRate: 40 } })];
      await injectFindings(findings, projectDir);

      const content = await readFile(join(claudeMdDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain('# My Rules');
      expect(content).toContain('Always use TypeScript.');
      expect(content).toContain('TOKENOMICS:START');
    });

    it('is idempotent — running twice produces same output', async () => {
      const projectDir = tempDir;
      const findings = [makeFinding({ detector: 'context-snowball', evidence: { avgInflectionTurn: 6 } })];

      await injectFindings(findings, projectDir);
      const first = await readFile(join(projectDir, '.claude', 'CLAUDE.md'), 'utf-8');

      await injectFindings(findings, projectDir);
      const second = await readFile(join(projectDir, '.claude', 'CLAUDE.md'), 'utf-8');

      expect(first).toBe(second);
    });

    it('returns empty result for no findings', async () => {
      const result = await injectFindings([]);
      expect(result.instructionCount).toBe(0);
      expect(result.changed).toBe(false);
    });

    it('replaces old managed block with new findings', async () => {
      const projectDir = tempDir;
      const claudeMdDir = join(projectDir, '.claude');

      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(claudeMdDir, { recursive: true });

      // Initial injection
      const findings1 = [makeFinding({ detector: 'context-snowball' })];
      await injectFindings(findings1, projectDir);

      // Second injection with different findings
      const findings2 = [makeFinding({ detector: 'model-selection', evidence: { overkillRate: 50 } })];
      await injectFindings(findings2, projectDir);

      const content = await readFile(join(claudeMdDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain('Sonnet');
    });
  });
});
