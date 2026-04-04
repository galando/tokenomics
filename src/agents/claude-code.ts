/**
 * Claude Code Agent Adapter
 *
 * Implements AgentAdapter for Claude Code by extracting existing
 * discovery, parsing, and config logic from the codebase.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type {
  AgentAdapter,
  DiscoveredFile as AgentDiscoveredFile,
  DiscoveryOptions as AgentDiscoveryOptions,
  BestPractice,
} from './types.js';
import type { DiscoveredFile } from '../discovery.js';
import { detectClaudeDirs, detectConfigPaths, getDefaultClaudeDir } from '../discovery.js';
import { parseSessionFile } from '../parser.js';
import type { SessionData } from '../types.js';

/**
 * Helper to find JSONL files in a directory
 */
async function findJsonlFiles(
  dirPath: string,
  projectName: string,
  cutoffDate: Date,
  sourceDir: string
): Promise<AgentDiscoveredFile[]> {
  const files: AgentDiscoveredFile[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

      const filePath = join(dirPath, entry.name);
      const stats = await stat(filePath);

      if (stats.mtime < cutoffDate) continue;

      const sessionId = basename(entry.name, '.jsonl');

      files.push({
        path: filePath,
        agent: 'claude-code',
        projectPath: dirPath,
        projectName,
        sessionId,
        modifiedAt: stats.mtime,
        size: stats.size,
        metadata: {
          sourceDir,
        },
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return files;
}

/**
 * Claude Code adapter implementation
 */
export const claudeCodeAdapter: AgentAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  capabilities: {
    hasNativeTokenCounts: true,
    hasModelInfo: true,
    hasToolUsage: true,
    hasTimingData: true,
    configFormat: 'json',
  },

  /**
   * Detect if Claude Code is installed
   */
  async detect(): Promise<boolean> {
    const dirs = await detectClaudeDirs();
    return dirs.length > 0;
  },

  /**
   * Discover Claude Code session files
   */
  async discover(options: AgentDiscoveryOptions): Promise<AgentDiscoveredFile[]> {
    // Use existing discovery logic
    const claudeDirs = await detectClaudeDirs();
    if (claudeDirs.length === 0) {
      return [];
    }

    const cutoffDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
    const files: AgentDiscoveredFile[] = [];
    const seenSessionIds = new Set<string>();

    for (const claudeDir of claudeDirs) {
      const projectsDir = join(claudeDir, 'projects');
      const dirLabel = basename(claudeDir);

      try {
        const projectDirs = await readdir(projectsDir, { withFileTypes: true });

        for (const projectDir of projectDirs) {
          if (!projectDir.isDirectory()) continue;

          const projectPath = join(projectsDir, projectDir.name);

          if (options.project) {
            const normalizedProject = options.project.replace(/\/$/, '');
            const normalizedDirName = projectDir.name;
            if (
              !normalizedDirName.includes(normalizedProject) &&
              !normalizedProject.includes(normalizedDirName)
            ) {
              continue;
            }
          }

          // Main session files
          const mainFiles = await findJsonlFiles(
            projectPath,
            projectDir.name,
            cutoffDate,
            dirLabel
          );
          for (const f of mainFiles) {
            if (!seenSessionIds.has(f.sessionId)) {
              seenSessionIds.add(f.sessionId);
              files.push(f);
            }
          }

          // Subagent files
          try {
            const entries = await readdir(projectPath, { withFileTypes: true });
            const subdirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);

            if (subdirNames.length > 0) {
              const subagentResults = await Promise.allSettled(
                subdirNames.map((dirName) =>
                  findJsonlFiles(
                    join(projectPath, dirName, 'subagents'),
                    projectDir.name,
                    cutoffDate,
                    dirLabel
                  )
                )
              );
              for (const result of subagentResults) {
                if (result.status === 'fulfilled') {
                  for (const f of result.value) {
                    if (!seenSessionIds.has(f.sessionId)) {
                      seenSessionIds.add(f.sessionId);
                      files.push(f);
                    }
                  }
                }
              }
            }
          } catch {
            // project dir read error
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    return files;
  },

  /**
   * Parse a Claude Code session file
   */
  async parse(file: AgentDiscoveredFile): Promise<SessionData | null> {
    // Convert to legacy DiscoveredFile format for parser
    const legacyFile: DiscoveredFile = {
      path: file.path,
      projectPath: file.projectPath,
      projectName: file.projectName,
      sessionId: file.sessionId,
      modifiedAt: file.modifiedAt,
      size: file.size,
      sourceDir: (file.metadata?.sourceDir as string) ?? basename(getDefaultClaudeDir()),
    };

    const session = await parseSessionFile(legacyFile);
    if (session) {
      // Override agent field
      session.agent = 'claude-code';
      session.rawTokenCounts = true;
    }
    return session;
  },

  /**
   * Get Claude Code config file paths
   */
  async getConfigPaths(): Promise<string[]> {
    return detectConfigPaths();
  },

  /**
   * Get Claude Code best practices
   */
  getBestPractices(): BestPractice[] {
    return [
      {
        id: 'use-compact',
        title: 'Use /compact to reset context',
        description:
          'Use the /compact command to clear conversation history and start fresh. This prevents context snowball and reduces token usage.',
        category: 'performance',
        severity: 'high',
        detectFn: (session: SessionData) => !session.compactUsed && session.turnCount > 10,
      },
      {
        id: 'optimize-claude-md',
        title: 'Optimize CLAUDE.md for token efficiency',
        description:
          'Keep your CLAUDE.md file focused and concise. Large context files inflate every conversation. Use the data optimization layer to manage injected sections.',
        category: 'cost',
        severity: 'medium',
      },
      {
        id: 'use-subagents',
        title: 'Split complex work into subagents',
        description:
          'For complex tasks, use the Agent tool or /compact to split work into focused sub-sessions. This keeps each session lean and fast.',
        category: 'workflow',
        severity: 'medium',
      },
      {
        id: 'model-selection',
        title: 'Use appropriate model for task complexity',
        description:
          'Claude Sonnet is fast and cost-effective for most coding tasks. Reserve Claude Opus for complex architecture and reasoning tasks.',
        category: 'cost',
        severity: 'low',
      },
    ];
  },

  /**
   * Map Claude Code tool names to universal concepts
   */
  getToolMapping(): Record<string, string> {
    return {
      Read: 'read',
      Edit: 'edit',
      Bash: 'bash',
      Grep: 'search',
      Glob: 'search',
      Agent: 'subagent',
      compact: 'context-management',
      Write: 'write',
      Create: 'write',
      Update: 'edit',
      Delete: 'delete',
    };
  },
};
