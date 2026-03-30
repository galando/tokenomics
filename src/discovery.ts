/**
 * JSONL File Discovery — Multi-Installation Support
 *
 * Auto-detects all ~/.claude* directories and discovers session files.
 * Supports --claude-dir flag for explicit override.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { DiscoveryOptions } from './types.js';

export interface DiscoveredFile {
  path: string;
  projectPath: string;
  projectName: string;
  sessionId: string;
  modifiedAt: Date;
  size: number;
  /** Which Claude installation this file came from */
  sourceDir: string;
}

export function getDefaultClaudeDir(): string {
  return join(homedir(), '.claude');
}

/**
 * Auto-detect all Claude installation directories in home.
 * Looks for ~/.claude/, ~/.claude-zai/, ~/.claude-*, etc.
 */
export async function detectClaudeDirs(): Promise<string[]> {
  const home = homedir();
  const dirs: string[] = [];

  try {
    const entries = await readdir(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.claude' || entry.name.startsWith('.claude-')) {
        // Verify it has a projects/ subdirectory
        const projectsDir = join(home, entry.name, 'projects');
        try {
          const s = await stat(projectsDir);
          if (s.isDirectory()) {
            dirs.push(join(home, entry.name));
          }
        } catch {
          // No projects dir — skip
        }
      }
    }
  } catch {
    // Can't read home directory
  }

  return dirs;
}

/**
 * Find all config file paths across detected Claude installations.
 * Returns paths like ~/.claude.json, ~/.claude-zai.json, .claude/settings.json
 */
export async function detectConfigPaths(): Promise<string[]> {
  const home = homedir();
  const paths: string[] = [];

  // Global configs: ~/.claude.json, ~/.claude-*.json
  try {
    const entries = await readdir(home);
    for (const entry of entries) {
      if (entry === '.claude.json' || entry.match(/^\.claude-.*\.json$/)) {
        paths.push(join(home, entry));
      }
    }
  } catch {
    // Can't read home
  }

  // Settings in installation dirs
  const claudeDirs = await detectClaudeDirs();
  for (const dir of claudeDirs) {
    const settingsPath = join(dir, 'settings.json');
    try {
      await stat(settingsPath);
      paths.push(settingsPath);
    } catch {
      // No settings file
    }
  }

  return paths;
}

export async function discoverFiles(options: DiscoveryOptions): Promise<DiscoveredFile[]> {
  // Determine which directories to scan
  let claudeDirs: string[];
  if (options.claudeDir) {
    // Explicit override — use only specified dir(s)
    claudeDirs = [options.claudeDir];
  } else {
    // Auto-detect all installations
    claudeDirs = await detectClaudeDirs();
    if (claudeDirs.length === 0) {
      // Fallback to default
      claudeDirs = [getDefaultClaudeDir()];
    }
  }

  const cutoffDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const files: DiscoveredFile[] = [];
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

        const jsonlFiles = await findJsonlFiles(projectPath, projectDir.name, cutoffDate, dirLabel);
        for (const f of jsonlFiles) {
          if (!seenSessionIds.has(f.sessionId)) {
            seenSessionIds.add(f.sessionId);
            files.push(f);
          }
        }

        const subagentsDir = join(projectPath, 'subagents');
        try {
          const subagentFiles = await findJsonlFiles(subagentsDir, projectDir.name, cutoffDate, dirLabel);
          for (const f of subagentFiles) {
            if (!seenSessionIds.has(f.sessionId)) {
              seenSessionIds.add(f.sessionId);
              files.push(f);
            }
          }
        } catch {
          // subagents directory may not exist
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
}

async function findJsonlFiles(
  dirPath: string,
  projectName: string,
  cutoffDate: Date,
  sourceDir: string,
): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];

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
        projectPath: dirPath,
        projectName,
        sessionId,
        modifiedAt: stats.mtime,
        size: stats.size,
        sourceDir,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return files;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function logDiscoverySummary(files: DiscoveredFile[], verbose: boolean): void {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const projects = new Set(files.map((f) => f.projectName));
  const sources = new Set(files.map((f) => f.sourceDir));

  if (verbose) {
    console.error(`Discovered ${files.length} session files across ${projects.size} projects`);
    console.error(`Total size: ${formatSize(totalSize)}`);
    if (sources.size > 1) {
      console.error(`Sources: ${[...sources].join(', ')}`);
    }
  }
}
