# Tokenomics — Token Intelligence for Claude Code

A CLI tool that analyzes your Claude Code session history to identify token waste patterns and provide actionable fixes. Runs locally, no LLM needed.

**v2.0.0** adds a **real-time optimization layer**: prompt analysis (`--prompt`), token budget tracking (`--budget`), and automatic behavioral coaching inside your Claude Code sessions.

## Install

```bash
npm install -g tokenomics
```

Or run directly:

```bash
npx tokenomics --html
```

## Quick Start

```bash
# First time — install hooks + create config
tokenomics --setup

# Analyze a prompt before sending to Claude
tokenomics --prompt "fix the typo in auth.ts"
# → Model:   sonnet (85%) — simple task keywords detected
# → Grade:   A — clean prompt
# → Savings: ~80% vs opus

# Check your token budget mid-session
tokenomics --budget
# → Session: 27% (134K / 500K)
# → Daily:    7% (134K / 2M)
# → Project:  1% (134K / 10M)

# Default: analyze session history
tokenomics                        # Terminal summary
tokenomics --html                 # HTML dashboard, opens in browser
tokenomics --json                 # Machine-readable JSON
```

## How It Works Inside Claude Code

After running `tokenomics --setup`, three things happen automatically every time you use Claude Code:

### 1. SessionStart Hook — Smart Coaching

When you start a Claude Code session, the SessionStart hook runs `tokenomics --inject --quiet`. This:

1. Reads your past session history (JSONL files in `~/.claude/projects/`)
2. Runs all detectors (context snowball, model selection, vague prompts, etc.)
3. **Writes behavioral insights into your CLAUDE.md** between `<!-- TOKENOMICS:START -->` and `<!-- TOKENOMICS:END -->` markers

Claude reads CLAUDE.md at the start of every session. It sees instructions like:

```markdown
<!-- TOKENOMICS:START -->
## Token Optimization Insights

### Model Usage
- You use Opus for **50%** of simple tasks. Prefer **Sonnet** for editing,
  small fixes, and exploration tasks to reduce token usage by ~5x.

### Context Management
- Your context snowballs at **turn 7** on average.
  Use `/compact` proactively after turn 5-7.
<!-- TOKENOMICS:END -->
```

Claude follows these automatically — no manual effort from you.

### 2. PostToolUse Hook — Budget Monitoring

After every tool use (Read, Edit, Bash, etc.), the PostToolUse hook runs `tokenomics --budget-check`. This:

1. Finds the active session JSONL file (most recently modified)
2. **Tail-reads only the last ~8KB** (not the whole file — keeps it under 200ms)
3. Sums token usage from the records
4. Compares against your budget ceilings
5. If a threshold is crossed (50%, 80%, 90%), updates CLAUDE.md with a budget warning

```
Your budget config (~/.claude/tokenomics.json):
  Session: 500K tokens    → warns at 250K (50%), 400K (80%), 450K (90%)
  Daily:   2M tokens      → same thresholds
  Project: 10M tokens     → same thresholds
```

When a threshold is crossed, Claude sees it in CLAUDE.md and adjusts (e.g., suggests wrapping up, or auto-downgrades to Sonnet if `ceilingAction` is `"downgrade"`).

### 3. Manual Commands — When You Need Them

| Command | When to Use |
|---------|------------|
| `--prompt "your prompt"` | Before sending a prompt — get model recommendation + quality grade |
| `--budget` | Mid-session — see full budget dashboard with progress bars |
| `--budget-check` | Used by hooks (silent, exit code 0/1) |
| `--setup` | One-time — install hooks + create budget config |
| `--inject` | Manually refresh CLAUDE.md insights |

## The `--prompt` Algorithm

`tokenomics --prompt "your prompt here"` does two things:

### Part 1: Model Routing

Analyzes the prompt for complexity signals and recommends the cheapest model that can handle it.

**Signal extraction:**
1. **Complex keywords** (word-boundary match): design, plan, combine, compare, analyze, integrate, understand, review, architecture, refactor, optimize, algorithm, etc.
2. **Simple keywords** (word-boundary match): fix, typo, rename, format, add, remove, delete, build, compile, lint, etc.
3. **Structural signals**: URL references, code blocks, file references, word count

**Routing priority:**
1. Complex keywords detected → Opus
2. Multiple complexity signals (2+) → Opus
3. URL reference → Opus (research/integration task)
4. High project simple rate (>60%) → Sonnet
5. Very short prompt (<10 words, no files) → Sonnet
6. Long prompt (>50 words) or many files (>3) → Opus
7. Simple keywords only → Sonnet
8. Default → Sonnet (safe for most tasks)

Complex signals always win over simple signals.

### Part 2: Prompt Quality Audit

Checks the prompt for waste patterns and assigns a grade.

**Built-in rules:**

| Rule | Detects | Severity |
|------|---------|----------|
| Redundant File Paste | Code blocks >30 lines pasted into prompt | Warning |
| Verbose Error Log | Stack traces >15 frames | Info |
| Low Specificity | <10 words, no file or function references | Info |
| Over-Scoped Request | "fix all", "refactor everything" patterns | Warning |
| Duplicate Context | Same sentence repeated 2+ times | Info |

**Grade calculation:**

| Grade | Criteria |
|-------|----------|
| A | Zero findings — prompt is well-optimized |
| B | Info findings only — minor improvements possible |
| C | Warnings present — prompt wastes tokens |
| D | Critical findings — significant waste |

**Combined output example:**

```
$ tokenomics --prompt "fix all the bugs everywhere and refactor everything"

Model:   opus (85%) — complex reasoning keywords detected
Grade:   B — 2 findings
Waste:   ~700 tokens

  [info] Low Specificity — Add specific file paths, function names
  [warning] Over-Scoped Request — Scope the work to specific files
```

## The Budget Algorithm

### How tokens are counted

Claude Code writes session data to JSONL files at `~/.claude/projects/<hash>/<session-id>.jsonl`. Each assistant message includes a `usage` field:

```json
{"type":"assistant","message":{"usage":{"input_tokens":2500,"output_tokens":800,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
```

Tokenomics sums `input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens` across records.

### How tail-read works

For the PostToolUse hook (runs after every tool use), reading the entire JSONL would be too slow. Instead:

1. Get file size via `fs.stat()`
2. If file > 8KB, open with `fs.open()` and read only the last 8KB
3. Discard the partial first line (we started mid-file)
4. Parse only those lines for token totals

This keeps the hook under 5ms for large session files.

### Three scopes

| Scope | Period | Default Ceiling |
|-------|--------|----------------|
| Session | Single Claude Code session | 500K tokens |
| Daily | Calendar day (all sessions today) | 2M tokens |
| Project | Rolling 30 days | 10M tokens |

### Alert thresholds

Each scope tracks alerts at 50%, 80%, and 90% of its ceiling. Alerts fire **exactly once** per threshold — the fired state is persisted in `~/.claude/tokenomics-alerts.json`.

When 100% is reached, the `ceilingAction` executes:
- `"warn"` — inject warning into CLAUDE.md
- `"downgrade"` — inject "switch to Sonnet" instruction
- `"pause"` — inject "ask user before continuing" instruction

### Configuration

Budget config lives at `~/.claude/tokenomics.json`:

```json
{
  "sessionCeiling": 500000,
  "dailyCeiling": 2000000,
  "projectCeiling": 10000000,
  "alertThresholds": [50, 80, 90],
  "ceilingAction": "warn"
}
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--prompt <text>` | Analyze a prompt: model recommendation + quality grade | - |
| `--budget` | Show token budget dashboard | false |
| `--budget-check` | Lightweight budget check (for hooks) | false |
| `--html` | Generate HTML report and open in browser | false |
| `--json` | Output JSON (pipe to jq, scripts, etc.) | false |
| `--report` | Full markdown coaching report | false |
| `--out <file>` | Write JSON to file | - |
| `--days <N>` | Analyze last N days | 30 |
| `--project <P>` | Filter to specific project path | - |
| `--claude-dir <path>` | Claude installation dir (default: auto-detect all `~/.claude*`) | auto |
| `--fix` | Apply auto-fixable optimizations | false |
| `--fix --dry-run` | Preview fixes without writing files | false |
| `--setup` | One-time setup: install hooks + create budget config + initial injection | false |
| `--inject` | Re-analyze sessions + update CLAUDE.md findings | false |
| `--quiet` | Suppress terminal output (used by hooks) | false |
| `--verbose` | Show discovery progress and debug info | false |
| `--help` | Show help message | - |
| `--version` | Show version | - |

## What `--fix` Does

1. **Set default model to Sonnet** — saves ~5x cost on simple sessions
   - Edits: `~/.claude/settings.json`
2. **Remove never-used MCP servers** — reduces overhead on every session
   - Edits: `~/.claude.json`
3. **Inject findings into CLAUDE.md** — behavioral coaching auto-applied
   - Edits: `.claude/CLAUDE.md` (project) and `~/.claude/CLAUDE.md` (global)

## Detectors

| Detector | What It Finds | Potential Savings |
|----------|--------------|-------------------|
| Context Snowball | Unbounded context growth | 40%+ |
| CLAUDE.md Overhead | Oversized config duplication | 5-15% |
| Model Selection | Suboptimal model choices | 3-5x |
| MCP Tool Tax | Rarely-used servers | Hidden token cost |
| Vague Prompts | Prompts requiring clarification | Turn reduction |
| File Read Waste | Unnecessary file re-reads | I/O + token cost |
| Bash Output Bloat | Excessive command output | Context pollution |
| Session Timing | Time-based efficiency patterns | Rate limit optimization |
| Subagent Opportunity | Delegation opportunities | Parallel execution |
| Smart Router | Historical routing patterns | ~80% on simple tasks |

## Output Examples

### Terminal

```
  TOKENOMICS — Token Intelligence for Claude Code
  60 sessions // 30 day range // v2.0.0

  Sessions:   60
  Total:     1.2M tokens
  Cache Hit: 42.3%
  Issues:    4

  ┌─────────────────────────┬──────────┬────────────┬────────────┐
  │ Detector                │ Severity │ Savings    │ Confidence │
  ├─────────────────────────┼──────────┼────────────┼────────────┤
  │ Context Snowball        │ ● HIGH   │ ~38%       │ 92%        │
  │ Model Selection         │ ● MED    │ ~15%       │ 85%        │
  └─────────────────────────┴──────────┴────────────┴────────────┘
```

### Prompt Analysis

```
$ tokenomics --prompt "design a multi-tenant database schema with row-level security"

Model:   opus (85%) — complex reasoning keywords detected
Grade:   A — clean prompt
```

### Budget Dashboard

```
$ tokenomics --budget

Token Budget Status
==================================================

SESSION: 82%
  ██████████████████████████████████████░░░░░░░░░░
  410,000 / 500,000 tokens

DAILY: 55%
  ███████████████████████████░░░░░░░░░░░░░░░░░░░░
  1,100,000 / 2,000,000 tokens

PROJECT: 32%
  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  3,200,000 / 10,000,000 tokens
```

## Privacy

- **Local-only**: No network calls, no telemetry
- **No API keys required**: Reads Claude Code's existing session files
- **No data leaves your machine**: All processing happens locally

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run tests (173 tests)
npm run typecheck  # Type checking
npm run dev        # Watch mode
```

## Requirements

- Node.js >= 18
- Claude Code installed (for session data to analyze)

## License

MIT
