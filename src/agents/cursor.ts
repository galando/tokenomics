/**
 * Cursor Agent Adapter
 *
 * Implements AgentAdapter for Cursor AI code editor.
 *
 * Data sources (macOS):
 * - ~/.cursor/ai-tracking/ai-code-tracking.db -- conversation IDs, file edits, models, timestamps
 * - ~/Library/Application Support/Cursor/User/workspaceStorage/$DIR/state.vscdb -- conversation metadata
 *
 * Uses sqlite3 CLI (pre-installed on macOS) for zero-dep SQLite access.
 */

import { stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentAdapter,
  DiscoveredFile,
  DiscoveryOptions,
  BestPractice,
} from './types.js';
import type { SessionData } from '../types.js';

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
   * Discover Cursor conversation files from AI tracking database
   *
   * Cursor stores conversation metadata in:
   * - ~/.cursor/ai-tracking/ai-code-tracking.db (conversation IDs, files, timestamps)
   * - ~/Library/Application Support/Cursor/User/workspaceStorage/$DIR/state.vscdb (composer metadata)
   */
  async discover(options: DiscoveryOptions): Promise<DiscoveredFile[]> {
    const home = homedir();
    const dbPath = join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
    const cutoffMs = Date.now() - options.days * 24 * 60 * 60 * 1000;
    const files: DiscoveredFile[] = [];

    try {
      const dbStat = await stat(dbPath);
      if (!dbStat.isFile()) return [];
    } catch {
      return [];
    }

    // Query conversation summaries from SQLite via sqlite3 CLI
    // Group edits by conversationId to reconstruct sessions
    const query = `SELECT conversationId, COUNT(*) as editCount, MIN(timestamp) as firstEdit, MAX(timestamp) as lastEdit, GROUP_CONCAT(DISTINCT model) as models, GROUP_CONCAT(DISTINCT fileName) as fileNames FROM ai_code_hashes GROUP BY conversationId HAVING lastEdit > ${cutoffMs} ORDER BY lastEdit DESC;`;

    let rows: string;
    try {
      const { execSync } = await import('node:child_process');
      rows = execSync(`sqlite3 "${dbPath}" "${query}" -separator "|"`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      return [];
    }

    if (!rows) return [];

    for (const row of rows.split('\n')) {
      const parts = row.split('|');
      if (parts.length < 5) continue;

      const conversationId = parts[0]!;
      const editCount = parseInt(parts[1]!, 10);
      const firstEdit = parseInt(parts[2]!, 10);
      const lastEdit = parseInt(parts[3]!, 10);
      const models = parts[4] ?? 'default';

      files.push({
        path: dbPath, // Reference the DB itself -- parse() will query it
        agent: 'cursor',
        projectPath: '',
        projectName: '',
        sessionId: conversationId,
        modifiedAt: new Date(lastEdit),
        size: 0,
        metadata: {
          source: 'cursor-ai-tracking',
          editCount,
          firstEdit,
          lastEdit,
          models,
          fileNames: parts[5] ?? '',
        },
      });
    }

    // Sort by modification date (newest first)
    files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    return files;
  },

  /**
   * Parse a Cursor conversation from ai-tracking database
   *
   * Queries the SQLite database for all edits belonging to this conversation,
   * then builds SessionData with estimated tokens.
   */
  async parse(file: DiscoveredFile): Promise<SessionData | null> {
    const meta = file.metadata as Record<string, unknown> | undefined;
    if (!meta) return null;

    const conversationId = file.sessionId;
    const editCount = (meta.editCount as number) ?? 0;
    const firstEdit = (meta.firstEdit as number) ?? 0;
    const lastEdit = (meta.lastEdit as number) ?? 0;
    const models = (meta.models as string) ?? 'default';
    const fileNames = (meta.fileNames as string) ?? '';

    if (editCount === 0) return null;

    // Extract the primary model (first one listed)
    const modelList = models.split(',').map((m) => m.trim()).filter(Boolean);
    const primaryModel = modelList[0] ?? 'default';

    // Build messages from edit data (we know edits, timestamps)
    const filesEdited = fileNames.split(',').filter(Boolean);
    const turnCount = Math.max(1, Math.ceil(editCount / 3)); // Rough estimate: 3 edits per turn

    const startedAt = new Date(firstEdit).toISOString();
    const endedAt = new Date(lastEdit).toISOString();

    // Estimate tokens based on edit count (each edit ~200-500 tokens average)
    const estimatedInputTokens = Math.round(turnCount * 350);
    const estimatedOutputTokens = Math.round(editCount * 200);

    // Build tool uses from file edits
    const toolUses: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      timestamp: string;
    }> = filesEdited.slice(0, 50).map((f, i) => ({
      id: `tool-${i}`,
      name: 'file_edit',
      input: { fileName: f },
      timestamp: startedAt,
    }));

    // Build user/assistant messages from turns
    const messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }> = [];
    for (let i = 0; i < turnCount; i++) {
      messages.push({
        role: 'user',
        content: `Edit ${i + 1}: ${filesEdited[i % filesEdited.length] ?? 'code changes'}`,
        timestamp: startedAt,
      });
      messages.push({
        role: 'assistant',
        content: `Applied ${Math.min(3, editCount - i * 3)} edits`,
        timestamp: startedAt,
      });
    }

    return {
      id: conversationId,
      agent: 'cursor',
      rawTokenCounts: false, // All tokens are estimated
      project: filesEdited[0] ? basename(dirname(filesEdited[0])) : 'unknown',
      projectPath: filesEdited[0] ? dirname(filesEdited[0]) : '',
      slug: conversationId.slice(0, 8),
      model: primaryModel,
      messages,
      toolUses,
      toolResults: [],
      totalInputTokens: estimatedInputTokens,
      totalOutputTokens: estimatedOutputTokens,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      turnCount,
      compactUsed: false,
      compactCount: 0,
      startedAt,
      endedAt,
      sourceFile: file.path,
    };
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
