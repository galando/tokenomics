# Tokenomics — Retroactive Token Intelligence for Claude Code

## Feature Specification

**Version:** 1.0
**Status:** READY FOR IMPLEMENTATION
**Type:** Claude Code Plugin
**Updated:** 2026-03-27

---

## Overview

Tokenomics is a Claude Code plugin that analyzes your complete session history, identifies behavioral patterns that waste tokens, and provides personalized coaching to reduce API costs.

### Key Value Propositions

- **Zero Extra API Cost**: Uses your existing Claude Code subscription for analysis
- **Retroactive Analysis**: Works on every session from day one — not just from install date
- **Personalized Coaching**: Claude references your own sessions by name, date, and prompt text
- **Immediate Value**: First run provides complete insights from all historical data

---

## Core Capabilities

### 1. JSONL Session Analysis
- Parse Claude Code session history files (~2s for 30 days)
- Extract token usage metrics (input, output, cache read/write)
- Identify tool usage patterns
- Track context window growth across turns

### 2. Nine Specialized Detectors

| Detector | What It Finds | User Impact |
|----------|--------------|-------------|
| Context Snowball | Unbounded context growth | 40% token savings potential |
| CLAUDE.md Overhead | Oversized config duplication | 5-15% per-project savings |
| Model Selection | Suboptimal model choices | 3-5x cost differences |
| MCP Tool Tax | Rarely-used servers with overhead | Hidden token cost per session |
| Vague Prompts | Prompts requiring extensive clarification | Turn reduction opportunities |
| Session Timing | Time-based efficiency patterns | Rate limit optimization |
| File Read Waste | Unnecessary file re-reads | I/O + token cost reduction |
| Bash Output Bloat | Excessive command output | Context pollution reduction |
| Subagent Opportunity | Delegation opportunities | Parallel execution benefits |

### 3. Structured Output for Claude Analysis

The plugin outputs structured JSON findings that Claude uses to:
- Explain patterns in conversational language
- Provide specific session examples with dates and names
- Calculate savings potential in percentage and absolute tokens
- Connect related patterns (e.g., context snowball + file re-reads)
- Offer actionable behavioral coaching

---

## Technical Architecture

### Plugin Execution Flow

```
/tokenomics
  ↓
Claude Code executes SKILL.md
  ↓
Bash tool runs: node dist/analyze.js --json
  ↓
Node.js Analysis Script:
  1. Discover JSONL files in ~/.claude/projects/*/sessions/
  2. Stream + parse all sessions
  3. Run 9 detectors with confidence scoring
  4. Output structured JSON
  ↓
Claude receives JSON, provides coaching
```

### Technology Stack

- **Language**: TypeScript (strict mode, ESM)
- **Build**: tsup (zero-config bundler)
- **Testing**: Vitest (fast, native ESM)
- **Runtime**: Node.js >=18
- **Dependencies**: Zero runtime dependencies (pure Node.js)

### Data Model

```typescript
interface SessionData {
  id: string;
  project: string;
  projectPath: string;
  slug?: string;
  messages: Message[];
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  turnCount: number;
  compactUsed: boolean;
  compactCount: number;
}

interface DetectorResult {
  detector: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  savingsPercent: number;
  savingsTokens: number;
  confidence: number;  // 0-1
  evidence: Record<string, unknown>;
}
```

---

## User Experience

### Command Interface

```bash
/tokenomics                    # Analyze last 30 days
/tokenomics --days 90          # Custom time range
/tokenomics --project myapp    # Specific project only
/tokenomics --verbose          # Include technical details
```

### Output Format

Claude provides conversational coaching with:

1. **Severity Summary**: "You have 2 high-impact patterns costing ~38% of your token budget"
2. **Pattern Explanations**: Plain-language descriptions with specific examples
3. **Session References**: "In your 'valiant-dazzling-crayon' session (March 12, temper project)..."
4. **Actionable Advice**: Concrete steps to change behavior
5. **Cross-Pattern Connections**: How patterns relate and compound

---

## Integration Points

### JSONL File Location
- Path: `~/.claude/projects/*/sessions/*.jsonl`
- Format: One JSON object per line (JSONL)
- Record types: `user`, `assistant`, `tool_use`, `tool_result`, `summary`

### Claude Code Integration
- Entry point: `SKILL.md` with Bash tool invocation
- Output: JSON to stdout (captured by Claude)
- Privacy: Runs locally, no network calls, no data leaves machine

### Configuration Files Analyzed
- `CLAUDE.md`: Per-project instructions
- `~/.claude.json`: MCP server configurations
- `~/.claude/settings.json`: Global settings

---

## Performance Requirements

| Metric | Target |
|--------|--------|
| Analysis time (30 days) | < 3 seconds |
| Memory usage | < 100MB |
| False positive rate | < 30% (Week 1), < 15% (Month 1) |
| Supported sessions | Unlimited (streaming parser) |

---

## Privacy & Security

- **Local-only execution**: No network calls
- **No data collection**: Everything stays on user's machine
- **No API keys**: Uses Claude Code's existing session
- **No telemetry**: Zero tracking or analytics

---

## Success Metrics

| Metric | Week 1 | Month 1 |
|--------|--------|---------|
| GitHub stars | 200 | 2,000 |
| Plugin installs | 300 | 3,000 |
| Analysis time (p95) | < 3s | < 3s |
| User-reported false positives | < 30% | < 15% |

---

## Differentiation

### vs. token-optimizer

| Aspect | token-optimizer | Tokenomics |
|--------|----------------|------------|
| **Data Source** | Hooks (from install) | JSONL (all history) |
| **Timing** | Real-time | On-demand retroactive |
| **Focus** | Config overhead | Behavioral patterns |
| **Historical Depth** | Install date forward | Day 1 complete |
| **Value Delivery** | Needs 1+ sessions | Immediate on first run |

**These tools are complementary**. Use token-optimizer for real-time session health, tokenomics for long-term behavior change.

---

## File Structure

```
tokenomics/
├── src/
│   ├── analyze.ts           # Entry point
│   ├── parser.ts            # JSONL streaming parser
│   ├── detectors/
│   │   ├── context-snowball.ts
│   │   ├── claude-md-overhead.ts
│   │   ├── model-selection.ts
│   │   ├── mcp-tool-tax.ts
│   │   ├── vague-prompts.ts
│   │   ├── session-timing.ts
│   │   ├── file-read-waste.ts
│   │   ├── bash-output-bloat.ts
│   │   └── subagent-opportunity.ts
│   ├── types.ts             # TypeScript interfaces
│   └── utils.ts             # Shared utilities
├── tests/
│   ├── fixtures/            # Anonymized session samples
│   └── *.test.ts            # Detector tests
├── dist/
│   └── analyze.js           # Compiled bundle
├── SKILL.md                 # Plugin definition
├── plugin.json              # Marketplace manifest
├── package.json
├── tsconfig.json
└── README.md
```

---

## Next Steps

1. Review intent.md for success criteria and BDD scenarios
2. Review plan.md for implementation phases
3. Review quickstart.md for development setup
4. Begin Phase 1: Foundation setup
