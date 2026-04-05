/**
 * Agent Context Utilities
 *
 * Provides utilities for detectors to work with agent-aware sessions.
 */

import type { AgentContext } from '../types.js';
import type { SessionData } from '../types.js';
import { getAdapters, getAdapter } from '../agents/registry.js';
import type { AgentAdapter } from '../agents/types.js';

/**
 * Build agent context from sessions
 */
export function buildAgentContext(sessions: SessionData[]): AgentContext {
  const agentIds = Array.from(new Set(sessions.map((s) => s.agent)));
  const hasEstimatedTokens = sessions.some((s) => s.rawTokenCounts === false);

  const adapters = new Map<string, AgentAdapter>();
  for (const adapter of getAdapters()) {
    adapters.set(adapter.id, adapter);
  }

  return {
    agentIds,
    hasEstimatedTokens,
    adapters,
  };
}

/**
 * Filter sessions to specific agents
 */
export function filterSessionsByAgent(
  sessions: SessionData[],
  agentIds: string[]
): SessionData[] {
  if (agentIds.length === 0) return sessions;
  return sessions.filter((s) => agentIds.includes(s.agent));
}

/**
 * Check if a detector supports a specific agent
 */
export function detectorSupportsAgent(
  detector: { supportedAgents?: string[] },
  agentId: string
): boolean {
  if (!detector.supportedAgents || detector.supportedAgents.length === 0) {
    return true; // Universal detector
  }
  return detector.supportedAgents.includes(agentId);
}

/**
 * Get agent name from ID
 */
export function getAgentName(agentId: string): string {
  const adapter = getAdapter(agentId);
  return adapter?.name ?? agentId;
}

/**
 * Map tool name to universal concept using agent adapter
 */
export function mapToolName(agentId: string, toolName: string): string {
  const adapter = getAdapter(agentId);
  if (!adapter) return toolName;

  const mapping = adapter.getToolMapping();
  return mapping[toolName] ?? toolName;
}

/**
 * Get agent-specific best practices
 */
export function getAgentBestPractices(agentId: string): import('../agents/types.js').BestPractice[] {
  const adapter = getAdapter(agentId);
  if (!adapter) return [];

  return adapter.getBestPractices();
}

/**
 * Check if a session has native token counts
 */
export function hasNativeTokenCounts(session: SessionData): boolean {
  return session.rawTokenCounts !== false;
}

/**
 * Reduce confidence for estimated tokens
 */
export function adjustConfidenceForEstimates(
  baseConfidence: number,
  sessions: SessionData[]
): number {
  const hasAnyEstimates = sessions.some((s) => !hasNativeTokenCounts(s));
  if (!hasAnyEstimates) return baseConfidence;

  // Reduce confidence by 20% if any estimates are present
  return Math.max(0.3, baseConfidence * 0.8);
}
