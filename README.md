# Tokenomics — Token Intelligence for Claude Code

A CLI tool that analyzes your Claude Code session history to identify token waste patterns and provide actionable fixes. Runs locally, no LLM needed.

**v1.3.0** introduces **native Claude Code integration** — tokenomics injects behavioral insights directly into your CLAUDE.md files and auto-updates via SessionStart hooks.

## Install

```bash
npm install -g tokenomics
```

Or run directly:

```bash
npx tokenomics --html
```

## Usage

```bash
tokenomics                        # Terminal summary (default)
tokenomics --html                 # HTML dashboard, opens in browser
tokenomics --json                 # Machine-readable JSON
tokenomics --report               # Full markdown coaching report
tokenomics --fix                  # Apply auto-fixable optimizations
tokenomics --fix --dry-run        # Preview fixes without writing
```

### Claude Code Integration

```bash
tokenomics --setup                # One-time: install hooks + inject findings into CLAUDE.md
tokenomics --inject               # Re-analyze + update CLAUDE.md findings
tokenomics --inject --quiet       # Silent mode (for hooks)
```

After `--setup`, every new Claude Code session automatically re-analyzes your usage and updates behavioral instructions in your CLAUDE.md. Claude adapts its behavior based on your actual patterns — no manual configuration needed.

#### What gets injected

Tokenomics writes a managed section between `<!-- TOKENOMICS:START -->` and `<!-- TOKENOMICS:END -->` markers. Everything outside these markers is never modified. Example:

```markdown
<!-- TOKENOMICS:START -->
## Token Optimization Insights

_Last updated: 2026-04-01_

### Context Management
- Your context snowballs at **turn 7** on average. Use `/compact` proactively after turn 5-7.

### Prompt Quality
- **15%** of your prompts are under 10 words. Include specific file paths and function names.

### Model Usage
- You use Opus for **40%** of simple tasks. Prefer **Sonnet** for editing and small fixes.
<!-- TOKENOMICS:END -->
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--html` | Generate HTML report and open in browser | false |
| `--json` | Output JSON (pipe to jq, scripts, etc.) | false |
| `--report` | Full markdown coaching report | false |
| `--out <file>` | Write JSON to file | - |
| `--days <N>` | Analyze last N days | 30 |
| `--project <P>` | Filter to specific project path | - |
| `--claude-dir <path>` | Claude installation dir (default: auto-detect all `~/.claude*`) | auto |
| `--fix` | Apply auto-fixable optimizations | false |
| `--fix --dry-run` | Preview fixes without writing files | false |
| `--setup` | One-time setup: install SessionStart hook + initial injection | false |
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

## Output Examples

### Terminal

```
  TOKENOMICS — Token Intelligence for Claude Code
  60 sessions // 30 day range // v1.0.0

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

### HTML Dashboard

The `--html` flag generates a self-contained HTML file with a Bento Grid layout, animated metrics, severity breakdowns, and per-detector detail panels. No external dependencies.

### JSON

```json
{
  "metadata": {
    "sessionCount": 60,
    "totalTokens": { "input": 1234567, "output": 234567, "cacheRead": 45000, "cacheCreation": 12000, "total": 1522134 },
    "version": "1.0.0"
  },
  "findings": [
    {
      "detector": "context-snowball",
      "title": "Context Snowball",
      "severity": "high",
      "savingsPercent": 38,
      "confidence": 0.92,
      "evidence": { ... }
    }
  ]
}
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
npm run dev        # Watch mode
```

## Requirements

- Node.js >= 18
- Claude Code installed (for session data to analyze)

## License

MIT
