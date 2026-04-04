/**
 * Multi-Agent Support - Core Types
 *
 * Defines the AgentAdapter interface and related types for supporting
 * multiple AI coding agents (Claude Code, Cursor, Copilot, Codex).
 */

import type { SessionData } from '../types.js';

// ============================================================================
// Agent Adapter Interface
// ============================================================================

/**
 * A file discovered by an agent adapter
 */
export interface DiscoveredFile {
  /** Absolute path to the file */
  path: string;
  /** Which agent this file belongs to */
  agent: string;
  /** Project path (if applicable) */
  projectPath: string;
  /** Project name (if applicable) */
  projectName: string;
  /** Session identifier */
  sessionId: string;
  /** Last modified time */
  modifiedAt: Date;
  /** File size in bytes */
  size: number;
  /** Additional agent-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for file discovery
 */
export interface DiscoveryOptions {
  /** Number of days to look back */
  days: number;
  /** Filter to specific project path (optional) */
  project?: string;
}

/**
 * Agent capabilities and features
 */
export interface AgentCapabilities {
  /** Whether this agent reports native token counts (vs estimates) */
  hasNativeTokenCounts: boolean;
  /** Whether this agent reports model information */
  hasModelInfo: boolean;
  /** Whether this agent reports tool/action usage */
  hasToolUsage: boolean;
  /** Whether this agent reports timing data */
  hasTimingData: boolean;
  /** Config file format (json, toml, yaml, etc.) */
  configFormat: string;
}

/**
 * A best practice recommendation for an agent
 */
export interface BestPractice {
  /** Unique identifier (kebab-case) */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description */
  description: string;
  /** Category: 'performance', 'cost', 'quality', 'workflow' */
  category: 'performance' | 'cost' | 'quality' | 'workflow';
  /** Severity: 'high', 'medium', 'low' */
  severity: 'high' | 'medium' | 'low';
  /** Optional detection function - returns true if this practice is being violated */
  detectFn?: (session: SessionData) => boolean;
}

/**
 * Interface for agent-specific adapters
 *
 * Each adapter handles discovery, parsing, and analysis for a specific AI coding agent.
 */
export interface AgentAdapter {
  /** Unique agent identifier (e.g., 'claude-code', 'cursor', 'copilot', 'codex') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Agent capabilities */
  capabilities: AgentCapabilities;

  /**
   * Detect whether this agent is installed on the system
   */
  detect(): Promise<boolean>;

  /**
   * Discover session files for this agent
   */
  discover(options: DiscoveryOptions): Promise<DiscoveredFile[]>;

  /**
   * Parse a single session file into normalized SessionData
   * Returns null if the file cannot be parsed
   */
  parse(file: DiscoveredFile): Promise<SessionData | null>;

  /**
   * Get configuration file paths for this agent
   * Used for optimization and injection
   */
  getConfigPaths(): Promise<string[]>;

  /**
   * Get agent-specific best practices
   */
  getBestPractices(): BestPractice[];

  /**
   * Map agent-specific tool names to universal concepts
   * e.g., { 'codebase_search': 'search', 'file_edit': 'edit' }
   */
  getToolMapping(): Record<string, string>;
}

// ============================================================================
// Extended Types for Multi-Agent Support
// ============================================================================

/**
 * Extended SessionData with agent field
 * This is a partial - the full SessionData is in ../types.ts
 */
export interface SessionDataWithAgent {
  /** Which agent this session came from */
  agent: string;
  /** Agent version (if available) */
  agentVersion?: string;
  /** Whether token counts are actual or estimated */
  rawTokenCounts?: boolean;
}
