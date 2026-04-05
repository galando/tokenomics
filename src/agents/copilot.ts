/**
 * GitHub Copilot Agent Adapter
 *
 * Implements AgentAdapter for GitHub Copilot Chat.
 * Copilot stores conversation history in VS Code extension storage.
 */

import { readdir, stat } from 'node:fs/promises';
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
 * Copilot adapter implementation
 */
export const copilotAdapter: AgentAdapter = {
  id: 'copilot',
  name: 'GitHub Copilot',
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
      const extensionsDir = join(home, '.vscode', 'extensions');
      const entries = await readdir(extensionsDir);
      return entries.some((e) => e.startsWith('github.copilot-chat-'));
    } catch {
      return false;
    }
  },

  async discover(_options: DiscoveryOptions): Promise<DiscoveredFile[]> {
    // Simplified implementation - returns empty array
    // Full implementation would scan VS Code extension storage
    return [];
  },

  async parse(_file: DiscoveredFile): Promise<SessionData | null> {
    // Simplified implementation
    // Full implementation would parse Copilot's conversation format
    return null;
  },

  async getConfigPaths(): Promise<string[]> {
    const home = homedir();
    const paths: string[] = [];

    try {
      const settingsPath = join(home, '.vscode', 'settings.json');
      await stat(settingsPath);
      paths.push(settingsPath);
    } catch {
      // File doesn't exist
    }

    return paths;
  },

  getBestPractices(): BestPractice[] {
    return [
      {
        id: 'use-slash-commands',
        title: 'Use Copilot slash commands',
        description:
          'Leverage slash commands like /workspace, /edit, and /tests for more focused interactions.',
        category: 'workflow',
        severity: 'medium',
      },
      {
        id: 'context-references',
        title: 'Use @workspace for context',
        description:
          'Use @workspace to include your entire codebase context for more relevant suggestions.',
        category: 'quality',
        severity: 'low',
      },
    ];
  },

  getToolMapping(): Record<string, string> {
    return {
      workspace_search: 'search',
      file_edit: 'edit',
      terminal: 'bash',
      create_file: 'write',
    };
  },
};
