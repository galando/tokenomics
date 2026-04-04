/**
 * Agent Adapter Registry
 *
 * Manages registration and discovery of agent adapters.
 * Provides unified interface for working with multiple agents.
 */

import type { AgentAdapter, DiscoveredFile, DiscoveryOptions } from './types.js';
import { claudeCodeAdapter } from './claude-code.js';
import { cursorAdapter } from './cursor.js';
import { copilotAdapter } from './copilot.js';
import { codexAdapter } from './codex.js';

/**
 * Registered adapters
 */
const adapters: Map<string, AgentAdapter> = new Map();

/**
 * Register an agent adapter
 */
export function registerAdapter(adapter: AgentAdapter): void {
  if (!adapter || !adapter.id) {
    console.warn('Attempted to register invalid adapter:', adapter);
    return;
  }
  adapters.set(adapter.id, adapter);
}

/**
 * Get all registered adapters
 */
export function getAdapters(): AgentAdapter[] {
  return Array.from(adapters.values());
}

/**
 * Get a specific adapter by ID
 */
export function getAdapter(id: string): AgentAdapter | undefined {
  return adapters.get(id);
}

/**
 * Get agent name by ID
 */
export function getAgentName(id: string): string | undefined {
  const adapter = adapters.get(id);
  return adapter?.name;
}

/**
 * Detect which agents are installed on the system
 */
export async function detectInstalledAgents(): Promise<AgentAdapter[]> {
  const detected: AgentAdapter[] = [];

  for (const adapter of adapters.values()) {
    try {
      const isInstalled = await adapter.detect();
      if (isInstalled) {
        detected.push(adapter);
      }
    } catch {
      // Detection failed - assume not installed
      continue;
    }
  }

  return detected;
}

/**
 * Discover session files across all detected agents
 */
export async function discoverAllFiles(options: DiscoveryOptions): Promise<DiscoveredFile[]> {
  const detected = await detectInstalledAgents();
  const allFiles: DiscoveredFile[] = [];

  // Discover files from each agent concurrently
  const results = await Promise.allSettled(
    detected.map((adapter) => adapter.discover(options))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allFiles.push(...result.value);
    }
    // Silently ignore discovery failures for individual agents
  }

  // Sort by modification date (newest first)
  allFiles.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return allFiles;
}

/**
 * Discover files from specific agents by ID
 */
export async function discoverFilesByAgents(
  agentIds: string[],
  options: DiscoveryOptions
): Promise<DiscoveredFile[]> {
  const allFiles: DiscoveredFile[] = [];

  for (const id of agentIds) {
    const adapter = adapters.get(id);
    if (!adapter) continue;

    try {
      const files = await adapter.discover(options);
      allFiles.push(...files);
    } catch {
      // Silently ignore discovery failures
    }
  }

  // Sort by modification date (newest first)
  allFiles.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return allFiles;
}

/**
 * Initialize default adapters
 */
export function initializeDefaultAdapters(): void {
  if (adapters.size === 0) {
    try {
      if (claudeCodeAdapter?.id) registerAdapter(claudeCodeAdapter);
      if (cursorAdapter?.id) registerAdapter(cursorAdapter);
      if (copilotAdapter?.id) registerAdapter(copilotAdapter);
      if (codexAdapter?.id) registerAdapter(codexAdapter);
    } catch (error) {
      console.warn('Failed to initialize default adapters:', error);
    }
  }
}

// Don't auto-initialize on import to avoid test issues
// initializeDefaultAdapters();
