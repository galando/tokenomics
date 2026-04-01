/**
 * Instruction Injection Engine — Data Optimization Layer
 *
 * Translates detector findings into CLAUDE.md behavioral instructions.
 * Uses managed block pattern (HTML comment markers) for non-destructive updates.
 */

import type { DetectorResult, InstructionBlock, InjectionResult } from './types.js';
import { findClaudeMdFiles, readClaudeMd, writeClaudeMd, fileExists, replaceManagedBlock } from './claude-config.js';

const CONFIDENCE_THRESHOLD = 0.3;

/**
 * Map each detector result to one or more instruction blocks.
 * Pure function — deterministic given the same input.
 */
export function findingsToInstructions(findings: DetectorResult[]): InstructionBlock[] {
  const instructions: InstructionBlock[] = [];

  for (const finding of findings) {
    if (finding.confidence < CONFIDENCE_THRESHOLD) continue;

    const block = detectorToInstruction(finding);
    if (block) {
      instructions.push(block);
    }
  }

  return instructions;
}

/**
 * Map a single detector result to an instruction block.
 */
function detectorToInstruction(finding: DetectorResult): InstructionBlock | null {
  const evidence = finding.evidence as Record<string, unknown>;

  switch (finding.detector) {
    case 'context-snowball': {
      const avgTurn = Math.round((evidence.avgInflectionTurn as number) ?? 8);
      const rate = Math.round((evidence.snowballRate as number) ?? 0);
      return {
        category: 'behavioral-coaching',
        instruction: `Your context snowballs at **turn ${avgTurn}** on average (${rate}% of sessions). Use \`/compact\` proactively after turn ${Math.max(avgTurn - 2, 4)}-${avgTurn} on long sessions to prevent unbounded growth.`,
        sourceDetector: 'context-snowball',
        confidence: finding.confidence,
      };
    }

    case 'model-selection': {
      const overkillRate = Math.round((evidence.overkillRate as number) ?? 0);
      return {
        category: 'model-recommendation',
        instruction: `You use Opus/Claude for **${overkillRate}%** of simple tasks. Prefer **Sonnet** for editing, small fixes, and exploration tasks to reduce token usage by ~5x on those sessions.`,
        sourceDetector: 'model-selection',
        confidence: finding.confidence,
      };
    }

    case 'vague-prompts': {
      const vagueRate = Math.round((evidence.vagueRate as number) ?? 0);
      return {
        category: 'prompt-improvement',
        instruction: `**${vagueRate}%** of your prompts are under 10 words. Include specific file paths, function names, and expected outcomes to reduce clarification rounds.`,
        sourceDetector: 'vague-prompts',
        confidence: finding.confidence,
      };
    }

    case 'bash-output-bloat': {
      return {
        category: 'behavioral-coaching',
        instruction: `You receive verbose command output. Prefer \`Grep\`/\`Read\` tools over bash commands when searching files to reduce output tokens.`,
        sourceDetector: 'bash-output-bloat',
        confidence: finding.confidence,
      };
    }

    case 'file-read-waste': {
      const wasteRate = finding.savingsPercent;
      return {
        category: 'behavioral-coaching',
        instruction: `You read files you don't end up using. Use \`Grep\` first to locate relevant files before reading them — reduces unnecessary context by ~${wasteRate}%.`,
        sourceDetector: 'file-read-waste',
        confidence: finding.confidence,
      };
    }

    case 'mcp-tool-tax': {
      const neverUsed = (evidence.neverUsedServers as string[]) ?? [];
      const serverNames = neverUsed.length > 0 ? neverUsed.join(', ') : 'some servers';
      return {
        category: 'model-recommendation',
        instruction: `MCP server(s) **${serverNames}** are loaded but never used. Consider removing them to reduce per-session overhead.`,
        sourceDetector: 'mcp-tool-tax',
        confidence: finding.confidence,
      };
    }

    case 'subagent-opportunity': {
      return {
        category: 'behavioral-coaching',
        instruction: `You could benefit from subagents for parallel tasks. Consider splitting multi-file operations into parallel agent tasks.`,
        sourceDetector: 'subagent-opportunity',
        confidence: finding.confidence,
      };
    }

    case 'session-timing': {
      return {
        category: 'behavioral-coaching',
        instruction: `Some sessions use significantly more tokens than others. Consider shorter, more focused sessions with clear goals.`,
        sourceDetector: 'session-timing',
        confidence: finding.confidence,
      };
    }

    case 'claude-md-overhead': {
      const size = finding.savingsPercent;
      return {
        category: 'behavioral-coaching',
        instruction: `CLAUDE.md instructions may be adding overhead (~${size}% of session tokens). Keep instructions concise and remove redundant entries.`,
        sourceDetector: 'claude-md-overhead',
        confidence: finding.confidence,
      };
    }

    default:
      return null;
  }
}

/**
 * Render instruction blocks into markdown between TOKENOMICS markers.
 */
export function renderInstructionBlock(instructions: InstructionBlock[]): string {
  if (instructions.length === 0) {
    return 'No optimization opportunities detected.';
  }

  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`## Token Optimization Insights`);
  lines.push('');
  lines.push(`_Last updated: ${now}_`);
  lines.push('');

  // Group by category
  const groups = new Map<string, InstructionBlock[]>();
  for (const inst of instructions) {
    const existing = groups.get(inst.category) ?? [];
    existing.push(inst);
    groups.set(inst.category, existing);
  }

  const categoryTitles: Record<string, string> = {
    'model-recommendation': '### Model Usage',
    'behavioral-coaching': '### Context Management',
    'prompt-improvement': '### Prompt Quality',
    'general': '### General',
  };

  for (const [category, items] of groups) {
    const title = categoryTitles[category] ?? '### Other';
    lines.push(title);
    for (const item of items) {
      lines.push(`- ${item.instruction}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Main entry point: generate instructions, find targets, read, replace, write.
 */
export async function injectFindings(
  findings: DetectorResult[],
  projectDir?: string,
): Promise<InjectionResult> {
  const instructions = findingsToInstructions(findings);

  if (instructions.length === 0 && findings.length === 0) {
    return {
      targets: [],
      instructionCount: 0,
      changed: false,
      instructions: [],
    };
  }

  const renderedBlock = renderInstructionBlock(instructions);
  const targets = findClaudeMdFiles(projectDir);
  let changed = false;

  for (const target of targets) {
    const existed = await fileExists(target.filePath);
    target.existed = existed;

    const existingContent = await readClaudeMd(target.filePath);
    const newContent = replaceManagedBlock(existingContent, renderedBlock);

    if (newContent !== existingContent) {
      await writeClaudeMd(target.filePath, newContent);
      changed = true;
    }
  }

  return {
    targets,
    instructionCount: instructions.length,
    changed,
    instructions,
  };
}
