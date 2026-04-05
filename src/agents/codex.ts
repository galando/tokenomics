/**
 * OpenAI Codex Agent Adapter
 *
 * Implements AgentAdapter for OpenAI Codex CLI.
 * Codex stores session data in ~/.codex/ or project .codex/ directories.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentAdapter,
  DiscoveredFile,
  DiscoveryOptions,
  BestPractice,
} from './types.js';
import type { SessionData } from '../types.js';

/**
 * Codex adapter implementation
 */
export const codexAdapter: AgentAdapter = {
  id: 'codex',
  name: 'OpenAI Codex',
  capabilities: {
    hasNativeTokenCounts: false,
    hasModelInfo: true,
    hasToolUsage: true,
    hasTimingData: true,
    configFormat: 'json',
  },

  async detect(): Promise<boolean> {
    const home = homedir();
    try {
      const codexDir = join(home, '.codex');
      await stat(codexDir);
      return true;
    } catch {
      return false;
    }
  },

  async discover(_options: DiscoveryOptions): Promise<DiscoveredFile[]> {
    // Simplified implementation - returns empty array
    // Full implementation would scan ~/.codex/ for session files
    return [];
  },

  async parse(_file: DiscoveredFile): Promise<SessionData | null> {
    // Simplified implementation
    // Full implementation would parse Codex's session format
    return null;
  },

  async getConfigPaths(): Promise<string[]> {
    const home = homedir();
    const paths: string[] = [];

    try {
      const configPath = join(home, '.codex', 'config.json');
      await stat(configPath);
      paths.push(configPath);
    } catch {
      // File doesn't exist
    }

    return paths;
  },

  getBestPractices(): BestPractice[] {
    return [
      {
        id: 'sandbox-efficiency',
        title: 'Use sandbox mode efficiently',
        description:
          'Sandbox mode provides safe execution but has overhead. Use it for testing, not every operation.',
        category: 'performance',
        severity: 'medium',
      },
      {
        id: 'prompt-specificity',
        title: 'Be specific in prompts',
        description:
          'Codex performs better with explicit, detailed prompts. Include context, expected output, and constraints.',
        category: 'quality',
        severity: 'high',
      },
    ];
  },

  getToolMapping(): Record<string, string> {
    return {
      shell: 'bash',
      file_edit: 'edit',
      file_read: 'read',
      create_file: 'write',
    };
  },
};
