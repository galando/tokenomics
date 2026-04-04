/**
 * Cursor Agent Adapter
 *
 * Implements AgentAdapter for Cursor AI code editor.
 * Cursor stores conversation history in JSON format in ~/.cursor/ or workspace .cursor/ directories.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentAdapter,
  DiscoveredFile,
  DiscoveryOptions,
  BestPractice,
} from './types.js';
import { estimateSessionTokens, getEstimationMetadata } from './token-estimation.js';
import type { SessionData } from '../types.js';

/**
 * Cursor conversation format (internal)
 */
interface CursorMessage {
  role: string;
  content: string;
  timestamp?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

interface CursorConversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: CursorMessage[];
  metadata?: {
    projectPath?: string;
    totalTokens?: number;
    totalCost?: number;
  };
}

/**
 * Build SessionData from Cursor conversation
 */
function buildSessionData(
  conversation: CursorConversation,
  file: DiscoveredFile
): SessionData | null {
  const messages: Array<{ role: string; content: string }> = [];
  const toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    timestamp: string;
  }> = [];
  const toolResults: Array<{
    tool_use_id: string;
    content: string;
    is_error: boolean;
    timestamp: string;
  }> = [];

  let toolIdCounter = 0;

  for (const msg of conversation.messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    } else if (msg.role === 'tool' && msg.toolName) {
      const toolId = `tool-${toolIdCounter++}`;
      toolUses.push({
        id: toolId,
        name: msg.toolName,
        input: msg.toolInput ?? {},
        timestamp: msg.timestamp ?? conversation.createdAt,
      });
    } else if (msg.role === 'tool_result') {
      const toolId = toolUses.length > 0 ? toolUses[toolUses.length - 1]!.id : 'unknown';
      toolResults.push({
        tool_use_id: toolId,
        content: msg.content,
        is_error: false,
        timestamp: msg.timestamp ?? conversation.createdAt,
      });
    }
  }

  // Estimate tokens (Cursor doesn't report native token counts)
  const estimates = estimateSessionTokens(messages, toolUses, toolResults);
  const estimationMetadata = getEstimationMetadata(false);

  // Extract project path from metadata
  const projectPath = conversation.metadata?.projectPath ?? '';
  const projectName = projectPath ? basename(projectPath) : 'unknown';

  return {
    id: conversation.id,
    agent: 'cursor',
    rawTokenCounts: estimationMetadata.isEstimated ? false : true,
    project: projectName,
    projectPath,
    slug: conversation.id.slice(0, 8),
    model: conversation.model,
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: conversation.createdAt,
    })),
    toolUses,
    toolResults,
    totalInputTokens: estimates.inputTokens,
    totalOutputTokens: estimates.outputTokens,
    totalCacheReadTokens: 0, // Cursor doesn't report cache
    totalCacheCreationTokens: 0,
    turnCount: messages.filter((m) => m.role === 'user').length,
    compactUsed: false, // Cursor doesn't have /compact
    compactCount: 0,
    startedAt: conversation.createdAt,
    endedAt: conversation.updatedAt,
    sourceFile: file.path,
  };
}

/**
 * Cursor adapter implementation
 */
export const cursorAdapter: AgentAdapter = {
  id: 'cursor',
  name: 'Cursor',
  capabilities: {
    hasNativeTokenCounts: false, // Cursor doesn't reliably report tokens
    hasModelInfo: true,
    hasToolUsage: true,
    hasTimingData: true,
    configFormat: 'json',
  },

  /**
   * Detect if Cursor is installed
   */
  async detect(): Promise<boolean> {
    const home = homedir();

    // Check for ~/.cursor/ directory
    try {
      const cursorDir = join(home, '.cursor');
      const s = await stat(cursorDir);
      if (s.isDirectory()) {
        return true;
      }
    } catch {
      // Continue to workspace check
    }

    return false;
  },

  /**
   * Discover Cursor conversation files
   */
  async discover(options: DiscoveryOptions): Promise<DiscoveredFile[]> {
    const home = homedir();
    const cursorDir = join(home, '.cursor');
    const cutoffDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
    const files: DiscoveredFile[] = [];

    try {
      // Check for conversations directory
      const convDir = join(cursorDir, 'conversations');
      const entries = await readdir(convDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

        const filePath = join(convDir, entry.name);
        const stats = await stat(filePath);

        if (stats.mtime < cutoffDate) continue;

        // Extract conversation ID from filename
        const conversationId = basename(entry.name, '.json');

        files.push({
          path: filePath,
          agent: 'cursor',
          projectPath: '', // Will be extracted from conversation content
          projectName: '', // Will be extracted from conversation content
          sessionId: conversationId,
          modifiedAt: stats.mtime,
          size: stats.size,
          metadata: {
            source: 'cursor-conversations',
          },
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Sort by modification date
    files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    return files;
  },

  /**
   * Parse a Cursor conversation file
   */
  async parse(file: DiscoveredFile): Promise<SessionData | null> {
    try {
      const content = await readFile(file.path, 'utf-8');
      const conversation = JSON.parse(content) as CursorConversation;

      return buildSessionData(conversation, file);
    } catch {
      return null;
    }
  },

  /**
   * Get Cursor config file paths
   */
  async getConfigPaths(): Promise<string[]> {
    const home = homedir();
    const paths: string[] = [];

    // .cursorrules file (workspace or global)
    try {
      const cursorRules = join(home, '.cursorrules');
      await stat(cursorRules);
      paths.push(cursorRules);
    } catch {
      // File doesn't exist
    }

    // Cursor settings
    try {
      const settingsPath = join(home, '.cursor', 'settings.json');
      await stat(settingsPath);
      paths.push(settingsPath);
    } catch {
      // File doesn't exist
    }

    return paths;
  },

  /**
   * Get Cursor best practices
   */
  getBestPractices(): BestPractice[] {
    return [
      {
        id: 'use-cursorrules',
        title: 'Use .cursorrules for project-specific instructions',
        description:
          'Create a .cursorrules file in your project root to define coding standards, preferred patterns, and project-specific context.',
        category: 'quality',
        severity: 'medium',
      },
      {
        id: 'context-pinning',
        title: 'Use context pinning for important files',
        description:
          'Pin frequently-used files to keep them in context. This reduces the need to repeatedly reference them.',
        category: 'performance',
        severity: 'low',
      },
      {
        id: 'model-selection',
        title: 'Choose appropriate model for task',
        description:
          'Use GPT-4o for most coding tasks. Reserve Claude Opus (if available) for complex reasoning and architecture.',
        category: 'cost',
        severity: 'low',
      },
      {
        id: 'composer-mode',
        title: 'Use Composer for multi-file changes',
        description:
          'For changes spanning multiple files, use Cursor Composer mode instead of individual edits.',
        category: 'workflow',
        severity: 'medium',
      },
    ];
  },

  /**
   * Map Cursor tool names to universal concepts
   */
  getToolMapping(): Record<string, string> {
    return {
      codebase_search: 'search',
      file_edit: 'edit',
      terminal: 'bash',
      search_files: 'search',
      read_file: 'read',
      create_file: 'write',
      delete_file: 'delete',
      composer: 'multi-file-edit',
    };
  },
};
