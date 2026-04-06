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

// ============================================================================
// Injection Types (Data Optimization Layer)
// ============================================================================

export interface InjectionTarget {
  /** Absolute path to CLAUDE.md */
  filePath: string;
  /** Whether the file existed before injection */
  existed: boolean;
  /** Scope: 'global' or 'project' */
  scope: 'global' | 'project';
}

export interface InstructionBlock {
  /** Machine-readable category */
  category: 'model-recommendation' | 'behavioral-coaching' | 'prompt-improvement' | 'general' | 'model-routing' | 'budget-status';
  /** Human-readable instruction for Claude */
  instruction: string;
  /** Source detector */
  sourceDetector: string;
  /** Confidence of the underlying finding */
  confidence: number;
}

export interface InjectionResult {
  /** Files that were modified or created */
  targets: InjectionTarget[];
  /** Number of instruction blocks generated */
  instructionCount: number;
  /** Whether any file was actually changed */
  changed: boolean;
  /** Generated instructions (for dry-run preview) */
  instructions: InstructionBlock[];
}

// ============================================================================
// Settings Optimization Types
// ============================================================================

export interface SettingsChange {
  /** What to change */
  type: 'model-default' | 'mcp-server-remove';
  /** File path being modified */
  file: string;
  /** Current value */
  current: string;
  /** Suggested value */
  suggested: string;
  /** Why this change is suggested */
  reason: string;
  /** Confidence 0-1 */
  confidence: number;
}

export interface AppliedChange {
  /** The change that was applied */
  change: SettingsChange;
  /** Whether it was actually applied (false in dry-run) */
  applied: boolean;
}

// ============================================================================
// Hook Types
// ============================================================================

export interface HookConfig {
  /** Hook type in Claude Code settings */
  type: 'SessionStart' | 'PostToolUse';
  /** The command to run */
  command: string;
  /** Whether the hook is currently installed */
  installed: boolean;
}

// ============================================================================
// Extended CLI Options
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
  /** Run injection only (no report) */
  inject: boolean;
  /** One-time setup: install hooks + initial injection */
  setup: boolean;
  /** Suppress output (used by SessionStart hooks) */
  quiet: boolean;
  /** Route a prompt to optimal model */
  route: string | undefined;
  /** Show budget dashboard */
  budget: boolean;
  /** Run lightweight budget check (for hooks) */
  budgetCheck: boolean;
  /** Audit a prompt for waste patterns */
  audit: boolean;
}

// ============================================================================
// Router Types (Smart Model Routing)
// ============================================================================

export interface PromptSignals {
  /** Number of words in the prompt */
  wordCount: number;
  /** Whether simple keywords are present */
  hasSimpleKeywords: boolean;
  /** Whether complex keywords are present */
  hasComplexKeywords: boolean;
  /** Number of file references detected */
  fileReferenceCount: number;
  /** List of file references found */
  fileReferences: string[];
}

export interface RouteDecision {
  /** Recommended model */
  model: 'claude-haiku-4-20250514' | 'claude-sonnet-4-6' | 'claude-opus-4-6';
  /** Confidence score (0-1) */
  confidence: number;
  /** Reason for the recommendation */
  reason: string;
  /** Estimated savings vs Opus (e.g., "~80% vs Opus") */
  estimatedSavings: string;
  /** Signals that led to the decision */
  signals: PromptSignals;
}

export interface RouterEvidence {
  /** Average tool uses per session */
  avgToolCount: number;
  /** Average file span (unique files accessed) */
  avgFileSpan: number;
  /** Percentage of sessions classified as simple */
  simpleSessionRate: number;
  /** Total sessions analyzed */
  totalSessions: number;
}

// ============================================================================
// Budget Types (Token Budget & Guardrails)
// ============================================================================

export type BudgetScope = 'session' | 'daily' | 'project';

export interface BudgetConfig {
  /** Session token ceiling */
  sessionCeiling: number;
  /** Daily token ceiling */
  dailyCeiling: number;
  /** Project token ceiling */
  projectCeiling: number;
  /** Alert thresholds (percentages) */
  alertThresholds: number[];
  /** Action when ceiling is reached: 'downgrade' | 'pause' | 'warn' */
  ceilingAction: 'downgrade' | 'pause' | 'warn';
}

export interface BudgetState {
  /** Scope being tracked */
  scope: BudgetScope;
  /** Current token usage */
  used: number;
  /** Ceiling for this scope */
  ceiling: number;
  /** Percentage used (0-100) */
  percent: number;
  /** Project name (if project scope) */
  project?: string;
}

export interface AlertEvent {
  /** Scope where alert fired */
  scope: BudgetScope;
  /** Threshold percentage that was crossed */
  threshold: number;
  /** Timestamp when alert fired */
  timestamp: string;
  /** Project (if project scope) */
  project?: string;
}

export interface BudgetCheckResult {
  /** States for all three scopes */
  states: BudgetState[];
  /** New alerts that fired in this check */
  newAlerts: AlertEvent[];
  /** Whether any ceiling was exceeded */
  ceilingExceeded: boolean;
  /** Which scope exceeded ceiling (if any) */
  exceededScope?: BudgetScope;
}

// ============================================================================
// Auditor Types (Prompt Quality Auditor)
// ============================================================================

export type AuditSeverity = 'critical' | 'warning' | 'info';

export type AuditGrade = 'A' | 'B' | 'C' | 'D';

export interface AuditFinding {
  /** Rule identifier */
  ruleId: string;
  /** Human-readable title */
  title: string;
  /** Severity level */
  severity: AuditSeverity;
  /** Finding description */
  description: string;
  /** Actionable suggestion */
  suggestion: string;
  /** Estimated tokens saved by addressing this */
  estimatedSavings: number;
}

export interface AuditContext {
  /** Optional file path for context */
  filePath?: string;
  /** Optional function name for context */
  functionName?: string;
  /** Maximum allowed code block lines */
  maxCodeBlockLines?: number;
  /** Maximum allowed stack trace frames */
  maxStackTraceFrames?: number;
}

export interface AuditRule {
  /** Rule identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Severity level */
  severity: AuditSeverity;
  /** Check function */
  check: (prompt: string) => AuditFinding | null;
}

export interface AuditReport {
  /** Overall grade (A=B, C=warnings, D=critical) */
  grade: AuditGrade;
  /** All findings found */
  findings: AuditFinding[];
  /** Total estimated savings across all findings */
  totalEstimatedSavings: number;
  /** Number of findings by severity */
  severityCounts: {
    critical: number;
    warning: number;
    info: number;
  };
}
