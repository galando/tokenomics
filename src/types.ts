/**
 * Core data types for Tokenomics
 * All types are strict - no `any` allowed
 */

// ============================================================================
// JSONL Record Types (from Claude Code session files)
// ============================================================================

export type JsonlRecordType =
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'progress'
  | 'system'
  | 'file-history-snapshot';

export interface JsonlUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  server_tool_use?: {
    web_search_requests: number;
    web_fetch_requests: number;
  };
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface JsonlMessage {
  role: 'user' | 'assistant';
  content: string | MessageContent[];
  type?: string;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface JsonlRecord {
  type: JsonlRecordType;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  session_id?: string;
  timestamp?: string;
  cwd?: string;
  slug?: string;
  version?: string;
  gitBranch?: string;
  userType?: string;
  isSidechain?: boolean;
  permissionMode?: string;
  message?: JsonlMessage & {
    model?: string;
    id?: string;
    usage?: JsonlUsage;
    stop_reason?: string | null;
    stop_sequence?: string | null;
  };
  subtype?: string;
  data?: unknown;
  durationMs?: number;
}

// ============================================================================
// Parsed Session Data
// ============================================================================

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  timestamp: string;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error: boolean;
  timestamp: string;
}

export interface SessionData {
  /** Unique session identifier */
  id: string;
  /** Project name derived from cwd */
  project: string;
  /** Absolute path to project directory */
  projectPath: string;
  /** Human-readable session slug (e.g., "valiant-dazzling-crayon") */
  slug: string;
  /** Model used for this session */
  model: string;
  /** All messages in the session */
  messages: Message[];
  /** All tool uses in the session */
  toolUses: ToolUse[];
  /** All tool results in the session */
  toolResults: ToolResult[];
  /** Total input tokens across all turns */
  totalInputTokens: number;
  /** Total output tokens across all turns */
  totalOutputTokens: number;
  /** Total cache read tokens */
  totalCacheReadTokens: number;
  /** Total cache creation tokens */
  totalCacheCreationTokens: number;
  /** Number of turns (user-assistant exchanges) */
  turnCount: number;
  /** Whether /compact was used */
  compactUsed: boolean;
  /** Number of times /compact was called */
  compactCount: number;
  /** Session start timestamp */
  startedAt: string;
  /** Session end timestamp */
  endedAt: string;
  /** Source file path */
  sourceFile: string;
}

// ============================================================================
// Context Turn Data (for snowball detection)
// ============================================================================

export interface ContextTurn {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalContext: number;
  role: 'user' | 'assistant';
  timestamp: string;
}

// ============================================================================
// Detector Results
// ============================================================================

export type Severity = 'high' | 'medium' | 'low';

export interface RemediationStep {
  /** What the user should do */
  action: string;
  /** How to do it (command, setting, or workflow change) */
  howTo: string;
  /** Expected impact of this step */
  impact: string;
}

export interface Remediation {
  /** Clear explanation of what's happening and why it's a problem */
  problem: string;
  /** Why this matters - cost, speed, and experience impact */
  whyItMatters: string;
  /** Ordered list of concrete steps to fix it */
  steps: RemediationStep[];
  /** Before/after examples or concrete illustrations */
  examples: Array<{
    label: string;
    before: string;
    after: string;
  }>;
  /** Quick win the user can do right now (< 2 minutes) — generic */
  quickWin: string;
  /**
   * Session-specific quick win built from real evidence.
   * References actual slugs, file names, and counts.
   * If no specific data available, falls back to quickWin.
   */
  specificQuickWin: string;
  /** Estimated effort: 'quick' (<5 min), 'moderate' (5-30 min), 'involved' (30+ min) */
  effort: 'quick' | 'moderate' | 'involved';
}

export interface DetectorResult {
  /** Detector identifier (kebab-case) */
  detector: string;
  /** Human-readable title */
  title: string;
  /** Impact severity */
  severity: Severity;
  /** Estimated savings as percentage of total tokens */
  savingsPercent: number;
  /** Estimated savings in absolute tokens */
  savingsTokens: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Detailed evidence for Claude to explain */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evidence: any;
  /** Actionable remediation guidance */
  remediation: Remediation;
  /**
   * Pre-rendered markdown showing EXACTLY which sessions and projects are affected.
   * SKILL.md should paste this verbatim — do NOT summarize or rephrase.
   * Format: project-grouped bullet list with session slugs, dates, and metrics.
   */
  sessionBreakdown: string;
}

// ============================================================================
// Analysis Output (top-level JSON schema)
// ============================================================================

export interface DateRange {
  start: string;
  end: string;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

export interface AnalysisMetadata {
  /** ISO timestamp when analysis was generated */
  generatedAt: string;
  /** Number of sessions analyzed */
  sessionCount: number;
  /** Date range of analyzed sessions */
  dateRange: DateRange;
  /** Token usage totals */
  totalTokens: TokenTotals;
  /** Analyzer version */
  version: string;
}

// ============================================================================
// Session Samples (raw transcript excerpts for Claude analysis)
// ============================================================================

export interface ToolCallSummary {
  /** Tool name (e.g. "Read", "Bash", "Grep") */
  name: string;
  /** 1-line summary of the tool input, truncated to 120 chars */
  inputSummary: string;
}

export interface TurnSummary {
  /** Turn index (0-based) */
  turnIndex: number;
  /** Message role */
  role: 'user' | 'assistant';
  /** For user turns: verbatim prompt text (truncated to 200 chars).
    * For assistant turns: omitted (too large). */
  content?: string;
  /** Input tokens for this turn */
  inputTokens: number;
  /** Output tokens for this turn */
  outputTokens: number;
}

export type SessionSelectionReason =
  | 'most-tokens'
  | 'most-flags'
  | 'most-tools'
  | 'worst-snowball';

export interface SessionSample {
  /** Session slug (e.g. "valiant-dazzling-crayon") */
  slug: string;
  /** Project name */
  project: string;
  /** Model used */
  model: string;
  /** First user prompt, verbatim, truncated to 300 chars */
  firstPrompt: string;
  /** Ordered sequence of tool calls (capped at 50) */
  toolSequence: ToolCallSummary[];
  /** Summary of remaining tools beyond the cap, e.g. "... and 150 more (Read: 80x, Edit: 40x)" */
  toolOverflow?: string;
  /** Per-turn token usage + user content */
  turns: TurnSummary[];
  /** Total input tokens */
  totalInputTokens: number;
  /** Total output tokens */
  totalOutputTokens: number;
  /** Number of turns */
  turnCount: number;
  /** Whether /compact was used */
  compactUsed: boolean;
  /** Number of times /compact was called */
  compactCount: number;
  /** Session start timestamp */
  startedAt: string;
  /** Which detectors flagged this session */
  flaggedBy: string[];
  /** Why this session was sampled */
  selectionReason: SessionSelectionReason;
}

export interface AnalysisOutput {
  /** Metadata about the analysis */
  metadata: AnalysisMetadata;
  /** All findings sorted by savingsPercent (descending) */
  findings: DetectorResult[];
  /** Condensed session samples for Claude to analyze.
    * Top N sessions by cost or detector flags.
    * Only populated when --out is used (JSON mode). */
  sessionSamples?: SessionSample[];
}

// ============================================================================
// CLI Options
// ============================================================================

export interface CliOptions {
  /** Output JSON format (for programmatic use) */
  json: boolean;
  /** Output full markdown coaching report */
  report: boolean;
  /** Generate self-contained HTML report and open in browser */
  html: boolean;
  /** Write JSON to this file path and print the path */
  out: string | undefined;
  /** Analyze last N days */
  days: number;
  /** Filter to specific project path */
  project: string | undefined;
  /** Include technical details */
  verbose: boolean;
  /** Show help message */
  help: boolean;
  /** Apply auto-fixable optimizations */
  fix: boolean;
  /** Preview fixes without writing files (use with --fix) */
  dryRun: boolean;
  /** Explicit Claude installation directories (overrides auto-detect) */
  claudeDirs: string[];
}

// ============================================================================
// Detector Interface
// ============================================================================

export type DetectorFunction = (sessions: SessionData[]) => DetectorResult | null;

export interface Detector {
  name: string;
  detect: DetectorFunction;
}

// ============================================================================
// Discovery Options
// ============================================================================

export interface DiscoveryOptions {
  days: number;
  project?: string;
  /** Single claude dir (for backward compat with fix module) */
  claudeDir?: string;
  /** Multiple explicit claude dirs (overrides auto-detect) */
  claudeDirs?: string[];
}
