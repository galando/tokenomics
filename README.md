# Tokenomics — Token Intelligence for Claude Code

A CLI tool that analyzes your Claude Code session history to identify token waste patterns and provide actionable fixes. Runs locally, no LLM needed.

**v2.3** adds `--analyze-skill` — analyze any AI agent skill package for token efficiency with cost estimates, letter grades, section-level breakdowns, and actionable shortening tips. Designed for integration with skill registries like [Tank](https://github.com/tankpkg/tank).

**The mental model: tokenomics is a coach, not a remote control.** It writes suggestions into your CLAUDE.md where Claude can see them. Claude is smart enough to follow most of them — suggesting `/compact` when context grows, recommending Sonnet for simple tasks, warning when you're overspending. But it cannot switch models, run commands, or force behavior. The user is always in control.

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

After running `tokenomics --setup`, two hooks are installed. They run silently in the background during your Claude Code sessions.

### 1. SessionStart Hook — Behavioral Coaching (automatic)

When you start a Claude Code session, the hook runs `tokenomics --inject --quiet`. This:

1. Reads your past session history (JSONL files in `~/.claude/projects/`)
2. Runs all detectors (context snowball, model selection, vague prompts, etc.)
3. Writes behavioral insights into your CLAUDE.md between `<!-- TOKENOMICS:START -->` and `<!-- TOKENOMICS:END -->` markers

Claude reads CLAUDE.md at session start and sees instructions like:

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

**What Claude actually does with this:**

| Instruction | What Claude does |
|------------|-----------------|
| "Prefer Sonnet for simple tasks" | Claude **suggests** switching to Sonnet. You still need to run `/model sonnet` yourself. |
| "Use /compact after turn 5-7" | Claude **suggests** running `/compact` when context grows. You run it. |
| "Include file paths in prompts" | Claude may **remind** you to be specific when you send vague prompts. |

Tokenomics cannot switch models or run commands on its own. It writes suggestions into CLAUDE.md, and Claude treats them as behavioral guidance. Think of it as a coach whispering tips — Claude listens, but the user is always in control.

### 2. PostToolUse Hook — Budget Monitoring (automatic)

After every tool use (Read, Edit, Bash, etc.), the hook runs `tokenomics --budget-check`. This:

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

When a threshold is crossed, CLAUDE.md gets updated. Claude then **suggests** actions like:
- At 80%: "You're at 82% of your session budget. Consider wrapping up."
- At 100%: "Session budget exceeded. Consider switching to Sonnet with `/model sonnet`."

**Important:** The `ceilingAction` setting (`"warn"`, `"downgrade"`, `"pause"`) controls what text gets injected into CLAUDE.md — not what Claude actually does. Claude reads the suggestion but cannot change the model itself.

### 3. Manual Commands — For When You Want More Control

| Command | When to Use |
|---------|------------|
| `--prompt "your prompt"` | Before a prompt — get model recommendation + quality grade, then manually pick the model |
| `--budget` | Mid-session — see full budget dashboard with progress bars |
| `--budget-check` | Used by hooks (silent, exit code 0/1) |
| `--setup` | One-time — install hooks + create budget config |
| `--inject` | Manually refresh CLAUDE.md insights |

## How `--prompt` Works

`tokenomics --prompt "your prompt here"` analyzes your prompt before you send it to Claude and returns two things:

1. **Model recommendation** — which Claude model is the best fit (and why)
2. **Quality grade** — whether your prompt will waste tokens

### Model Routing

The router reads your prompt for complexity signals:

| Signal | Example | Routes to |
|--------|---------|-----------|
| Complex keywords | "design", "plan", "analyze", "refactor", "architecture" | Opus |
| Simple keywords | "fix", "rename", "format", "lint" | Sonnet |
| URLs or code blocks | `https://...`, `` ```code``` `` | Opus |
| Very short prompt | <10 words, no file references | Sonnet |
| Multiple file references | >3 files mentioned | Opus |

**Priority:** Complex signals always win. If your prompt says "fix the typo" it routes to Sonnet (~80% cheaper). If it says "design and implement" it routes to Opus.

### Prompt Quality Audit

Checks your prompt for common waste patterns and assigns a grade:

| Grade | Meaning |
|-------|---------|
| A | Clean — no issues found |
| B | Minor — small improvements possible |
| C | Warning — prompt wastes tokens |
| D | Critical — significant waste |

The audit detects: pasted code blocks that Claude could read itself, vague prompts without file/function names, over-scoped requests like "fix everything", and duplicate context.

### Example

```
$ tokenomics --prompt "fix all the bugs everywhere and refactor everything"

Model:   opus (85%) — complex reasoning keywords detected
Grade:   B — 2 findings
Waste:   ~700 tokens

  [info] Low Specificity — Add specific file paths, function names
  [warning] Over-Scoped Request — Scope the work to specific files
```

## How the Budget Works

Tokenomics tracks your token spend across three scopes:

| Scope | What it measures | Default ceiling |
|-------|-----------------|----------------|
| Session | Current active Claude Code session | 500K tokens |
| Daily | All sessions today (currently: same as session) | 2M tokens |
| Project | Rolling 30 days (currently: same as session) | 10M tokens |

### How it counts tokens

The budget reads the **current active session** — the most recently modified JSONL file in `~/.claude/projects/`. It sums `input_tokens + output_tokens + cache tokens` from each assistant message. For the background hook (runs after every tool use), it only reads the last 8KB of the file to keep it fast.

**Current limitation:** Daily and project scopes both read from the same active session file. Aggregation across all session files is planned for a future release. For now, all three scopes show the same number.

### Alert thresholds

Each scope triggers alerts at 50%, 80%, and 90% of its ceiling. Each alert fires **once** — tokenomics remembers which thresholds have already fired.

When a scope hits 100%, the `ceilingAction` setting controls what Claude sees:

| Action | What happens |
|--------|-------------|
| `warn` (default) | Claude suggests wrapping up or being more concise |
| `downgrade` | Claude suggests switching to Sonnet (`/model sonnet`) |
| `pause` | Claude asks for your confirmation before continuing |

These are suggestions Claude reads from CLAUDE.md — tokenomics cannot force model changes.

### Disable alerts

To turn off budget alerts entirely:

```bash
# One-time: run budget check without alerts
tokenomics --budget --no-alerts

# Persistent: add to config
# Edit ~/.claude/tokenomics.json and set "muteAlerts": true
```

When `muteAlerts` is `true`, the budget check still runs and shows the dashboard, but no alerts are injected into CLAUDE.md.

### Configuration

Budget config lives at `~/.claude/tokenomics.json`:

```json
{
  "sessionCeiling": 500000,
  "dailyCeiling": 2000000,
  "projectCeiling": 10000000,
  "alertThresholds": [50, 80, 90],
  "ceilingAction": "warn",
  "muteAlerts": false
}
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--prompt <text>` | Analyze a prompt: model recommendation + quality grade | - |
| `--budget` | Show token budget dashboard | false |
| `--budget-check` | Lightweight budget check (for hooks) | false |
| `--no-alerts` | Suppress budget alerts (no CLAUDE.md injection) | false |
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
| `--analyze-skill <dir>` | Analyze skill package for token efficiency | - |
| `--help` | Show help message | - |
| `--version` | Show version | - |

## What `--fix` Does

1. **Set default model to Sonnet** — edits `~/.claude/settings.json` to make Sonnet the default. This is a real settings change — Claude Code will use Sonnet by default on new sessions (you can still switch with `/model`).
2. **Remove never-used MCP servers** — edits `~/.claude.json` to remove servers that haven't been used in any of your sessions. Reduces per-session overhead.
3. **Inject findings into CLAUDE.md** — writes behavioral coaching into your CLAUDE.md (project and global). Claude reads and follows these as suggestions.

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

## Skill Analysis (`--analyze-skill`)

Analyze an AI agent skill package directory for token efficiency. Produces a grade (A/B/C/D), cost per use in real money, per-section token breakdowns, and actionable suggestions for what to cut and why.

```bash
# Terminal report (default)
tokenomics --analyze-skill ./my-skill

# JSON output (for scripts, CI, Tank integration)
tokenomics --analyze-skill ./my-skill --json
```

### Terminal output

```
  SKILL TOKEN ANALYSIS
  ──────────────────────────────────────────────────

  "Well-structured skill with no significant waste."

  Grade:  A  (86/100)
  Size:   33,598 tokens — above average (avg is ~20,000 tokens)

  [░░░░░░░░░░░░░█░░░░░░░░░░░░░░░░]
           ▲ avg

  Cost per use:  ~$0.18 (Sonnet)  |  ~$0.91 (Opus)

  Findings (3):
  ● prompt-size [medium]
    Prompt file "SKILL.md" is ~2,388 tokens (9,549 chars).
    Consider trimming for faster invocations.
    Fix: Consider trimming "SKILL.md" to under 2000 tokens.
    Extract verbose examples into separate reference files.

  ● section-analysis [low]
    SKILL.md: 2 section(s) overlap each other.
    Fix: "web app setup" overlaps with "library setup":
    consolidate shared content into one section.
    Tip: References 18 specific file paths — consider
    replacing with a glob pattern or naming convention rule.
```

### JSON output

With `--json`, the output includes all fields for programmatic consumption:

```json
{
  "one_liner": "Slightly above average size. Works fine, could be leaner.",
  "grade": "B",
  "estimated_tokens": 8500,
  "comparison": "8,500 tokens — below average (avg is ~20,000 tokens)",
  "cost_per_use": {
    "sonnet": "~$0.05",
    "opus": "~$0.23"
  },
  "what_this_means": "Bigger skills cost more per invocation and leave less room for conversation. Smaller skills respond faster and cost less.",
  "findings": [
    {
      "rule": "section-analysis",
      "severity": "low",
      "description": "SKILL.md: 2 section(s) overlap each other...",
      "remediation": "\"Setup\" overlaps with \"Config\": consolidate...",
      "sections": [
        { "heading": "Setup", "tokens": 420, "redundantWith": ["Config"] },
        { "heading": "Config", "tokens": 380, "redundantWith": ["Setup"] }
      ]
    }
  ],
  "summary": {
    "total_findings": 3,
    "estimated_tokens_per_invocation": 8500,
    "efficiency_score": 72
  }
}
```

### Report fields

| Field | What it means |
|-------|---------------|
| `one_liner` | Plain English summary of the skill's efficiency |
| `grade` | A (lean) / B (good) / C (bloated) / D (wasteful) |
| `estimated_tokens` | Total token count across all skill files |
| `comparison` | How this skill compares to average (~20k tokens) |
| `cost_per_use` | Real money per invocation on Sonnet and Opus |
| `what_this_means` | Why size matters: cost + speed + context window competition |
| `sections[]` | Per-heading token breakdown with redundancy and shortening tips |

### Analysis rules

| Rule | What it checks | Thresholds |
|------|---------------|------------|
| `prompt-size` | SKILL.md and `.atom.md` files exceeding token limits | >2000 tokens = medium, >4000 = high |
| `claude-md-size` | CLAUDE.md injection blocks that bloat system prompts | >1500 tokens = medium, >3000 = high |
| `tool-overhead` | Tool definitions in manifest (tank.json, skills.json) | >8 tools = medium, >15 = high |
| `large-files` | Files with >500 lines that are expensive to read | >500 lines = low, >1000 = medium |
| `redundant-instructions` | Duplicated instruction lines across skill files | >30% duplication = low/medium |
| `section-analysis` | Per-section token breakdown, cross-file redundancy, content tips | See below |

### Section analysis details

The `section-analysis` rule parses markdown headings and provides:

**Token breakdown**: Every section gets a token count, so you can see exactly where the weight is.

**Cross-file redundancy**: Detects when a section in SKILL.md says the same thing as a section in `references/*.md`. Example: `"The Bridge"` in SKILL.md duplicates `"The Bridge Model"` in `references/orchestration-workflow.md`.

**Content-level shortening tips** (not just structural):

| Tip | What it detects |
|-----|----------------|
| Concept repetition | Same key phrase restated 3+ times — state once, reference elsewhere |
| Restatements | "remember that", "note that", "in other words" — AI understood the first time |
| Bad/good example pairs | Shows both wrong and right patterns — use a negative constraint rule instead |
| File path enumeration | 6+ specific paths — replace with glob patterns or naming conventions |
| Verbose justification | "this is important because" — AI follows rules without persuasion |
| Large directory trees | ASCII trees >10 lines — keep top-level, link to reference |
| Repeated lines | Identical lines within a section — dedup or collapse |
| Code block bloat | 2+ code blocks — replace with file references |
| Long lists | 8+ list items — group into categories |
| Table bloat | 15+ table rows — move details to reference files |

### Cost estimation

Based on Claude API pricing with an 80/20 input/output token split:

| Tokens | Sonnet cost | Opus cost |
|--------|-------------|-----------|
| 5,000 | ~$0.03 | ~$0.15 |
| 20,000 (avg) | ~$0.12 | ~$0.59 |
| 50,000 | ~$0.29 | ~$1.47 |
| 100,000 | ~$0.59 | ~$2.94 |

Every skill is loaded into context on every turn. A 50k-token skill costs ~$1.47 per turn on Opus — trimming it to 20k saves ~$0.88 per turn.

### Integration with skill registries

Designed to be called as a subprocess from scanning pipelines:

```python
import subprocess, json

result = subprocess.run(
    ["tokenomics", "--analyze-skill", skill_dir, "--json"],
    capture_output=True, text=True, timeout=10
)
if result.returncode == 0:
    analysis = json.loads(result.stdout)
    print(f"Grade: {analysis['grade']} | Cost: {analysis['cost_per_use']['sonnet']}/use")
    for finding in analysis["findings"]:
        print(f"[{finding['severity']}] {finding['rule']}: {finding['description']}")
```

Graceful degradation: if tokenomics is not installed, skip the stage and continue.

## Output Examples

### Terminal

```
  TOKENOMICS — Token Intelligence for Claude Code
  60 sessions // 30 day range // v2.3.0

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

  ──────────────────────────────────────────────────────────────
  ● Your context window ballooned without /compact in 12 of 60 sessions (20%).

  Evidence:
    Worst: my-project on Mar 24 at 14:30 — context grew 4.2x by message 9,
    wasting 38K tokens.
    You were working on: "refactor the auth module"

  Impact:    Every message in a snowballed session re-sends the entire
             conversation history, compounding token cost.

  Action:
    In my-project, your context typically snowballs around message 9.
    Run /compact around message 7 — before it grows, not after.
    When switching to a different task, run /clear instead.
```

### HTML Report

The `--html` report now features:

- **Collapsible sections** — Overview, Findings, and Actions sections are open by default and can be collapsed/expanded. State persists via localStorage.
- **Human-readable finding cards** — Each finding has four parts: headline, evidence, impact, and action. Cards are collapsible and filterable by severity.
- **Plain-English explanations** — Instead of jargon like "turn 8 snowball detected", findings say "your context typically snowballs around message 9 in my-project — run /compact around message 7".

```bash
tokenomics --html    # Opens interactive report in browser
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
npm test           # Run tests
npm run typecheck  # Type checking
npm run dev        # Watch mode
```

## Requirements

- Node.js >= 18
- Claude Code installed (for session data to analyze)

## License

MIT
