# Tokenomics — Implementation Plan

## Project Timeline: 17 Days

**Complexity Assessment**: MEDIUM
- Well-defined scope with clear data model
- Zero external dependencies reduces risk
- Proven plugin architecture (token-optimizer pattern)
- Main challenge: detector accuracy and Claude coaching quality

---

## Phase 1: Foundation (Days 1-3)

### Goal
Establish build system, parser infrastructure, and test fixtures.

### Tasks

#### 1.1 Project Setup
- [ ] Initialize `package.json` with TypeScript, tsup, vitest
- [ ] Configure `tsconfig.json` (strict mode, ESM)
- [ ] Set up tsup for zero-config bundling
- [ ] Configure vitest for fast testing
- [ ] Create `.gitignore` and `.editorconfig`

**Done When**: `npm run build` produces clean `dist/analyze.js`, `npm test` passes

#### 1.2 TypeScript Interfaces
- [ ] Define `SessionData`, `Message`, `ToolUse`, `ToolResult`
- [ ] Define `DetectorResult` interface
- [ ] Define `AnalysisOutput` (top-level JSON schema)
- [ ] No `any` types — strict mode compliance

**Done When**: Compiles without errors, all types defined

#### 1.3 JSONL File Discovery
- [ ] Scan `~/.claude/projects/*/sessions/*.jsonl`
- [ ] Filter by `--days` flag (default 30)
- [ ] Filter by `--project` flag (optional)
- [ ] Handle missing paths gracefully
- [ ] Log file count and total size

**Done When**: Correctly discovers files, tests pass for edge cases

#### 1.4 Streaming JSONL Parser
- [ ] Implement line-by-line streaming parser
- [ ] Handle 5 record types: `user`, `assistant`, `tool_use`, `tool_result`, `summary`
- [ ] Skip malformed JSON with warning
- [ ] Aggregate into `SessionData` objects
- [ ] Handle large files without memory issues

**Done When**: Parses real JSONL files, handles errors gracefully, tests pass

#### 1.5 Test Fixtures
- [ ] Create 6 anonymized JSONL fixtures from real sessions
  - Fixture 1: Context snowball scenario
  - Fixture 2: Large CLAUDE.md with config duplication
  - Fixture 3: Simple session (sonnet-sufficient)
  - Fixture 4: High MCP server usage
  - Fixture 5: Vague prompts with clarification rounds
  - Fixture 6: Normal healthy session (control)

**Done When**: All fixtures load correctly, represent realistic scenarios

---

## Phase 2: High-Impact Detectors (Days 4-8)

### Goal
Implement the 5 detectors with highest user impact.

### Detector Implementation Pattern

Each detector follows this structure:
```typescript
export function detectPattern(session: SessionData): DetectorResult | null {
  // 1. Check if session matches pattern criteria
  // 2. Calculate metrics and evidence
  // 3. Determine severity and savings estimate
  // 4. Return structured result or null
}
```

### 2.1 Context Snowball Detector

**Algorithm**:
- Build context series using `totalContext = inputTokens + cacheReadTokens + cacheWriteTokens`
- Filter out turns with `totalContext < 500` (hook/subagent noise)
- Calculate baseline: median of first 3 substantial turns
- Find inflection: first turn where `totalContext > 2.5x baseline`
- Calculate growth multiplier: peak / baseline
- Calculate excess context tokens (rate-limit impact)
- Calculate excess cost weighted (API impact with cache pricing)
- Detect topic shifts using Jaccard similarity (threshold 0.25)

**Severity Thresholds**:
- HIGH: >50% sessions with snowball AND compactUsedRate < 10%
- MEDIUM: 30-50% sessions
- LOW: <30% sessions

**Done When**:
- [ ] Inflection turn detection verified against fixture
- [ ] Topic shifts detected correctly
- [ ] Both savings metrics calculated (rate-limit + API cost)
- [ ] Claude can explain: "By turn 12, you had 20x context growth"

### 2.2 Model Selection Detector

**Algorithm**:
- Classify session complexity:
  - Simple: <5 tool uses, all Read/Edit/Bash
  - Medium: 5-15 tool uses OR any Agent tool
  - Complex: >15 tool uses OR multi-file refactors
- Check if model choice matches complexity
- Calculate cost difference using pricing data

**Done When**:
- [ ] Simple session classified as sonnet-sufficient
- [ ] Complex session not flagged
- [ ] Cost difference calculated correctly

### 2.3 File Read Waste Detector

**Algorithm**:
- Track all `Read` tool uses per file
- Categories:
  - Unused: Read but never referenced in subsequent Edit/Write
  - Duplicate: Read multiple times without modification
  - Generated: Read files in dist/, node_modules/, .git/
- Calculate wasted tokens

**Done When**:
- [ ] All 3 categories detected
- [ ] Unused reads identified
- [ ] Duplicate reads counted

### 2.4 Bash Output Bloat Detector

**Algorithm**:
- Analyze `Bash` tool results
- Categories:
  - Excessive flags: `ls -R`, `find` without limits
  - Verbose output: commands with unnecessary verbosity
  - Missing pagination: no `| head`, `| tail`, `| less`
  - Full file dumps: `cat` on large files
  - Usage checks: flag `--help` and `--version` commands

**Done When**:
- [ ] All 5 categories detected
- [ ] Usage check pattern works
- [ ] Suggestions provided for each category

### 2.5 Vague Prompts Detector

**Algorithm**:
- Identify user messages with high clarification rounds
- Detect vague criteria:
  - <10 words
  - Missing specific nouns (file names, function names)
  - Ambiguous verbs ("fix", "improve", "optimize")
- Check session outcome (not CLEAN = bad outcome)
- Mine positive examples from successful sessions

**Done When**:
- [ ] Vague criteria correctly identified
- [ ] Positive examples mined
- [ ] Bad outcomes flagged

---

## Phase 3: Remaining Detectors (Days 9-11)

### 3.1 CLAUDE.md Overhead Detector

**Algorithm**:
- Read `CLAUDE.md` from each project path
- Estimate token count: `content.length / 3.5`
- Detect waste patterns:
  - Duplicate config: keywords existing in `.eslintrc`, `tsconfig.json`, etc.
  - Skill candidates: content better suited for on-demand skills
  - Outdated content: references to deleted files, old patterns

**Done When**:
- [ ] Reads CLAUDE.md files correctly
- [ ] Detects duplicate config content
- [ ] Identifies skill candidates

### 3.2 MCP Tool Tax Detector

**Algorithm**:
- Read `~/.claude.json` for MCP server configurations
- Cross-reference with session `tool_use` data
- Calculate:
  - Servers never used (100% overhead)
  - Servers rarely used (<5% of sessions)
  - Per-session token cost of enabled servers

**Done When**:
- [ ] Reads `~/.claude.json` correctly
- [ ] Cross-references with session data
- [ ] Identifies rarely-used servers

### 3.3 Session Timing Detector

**Algorithm**:
- Group sessions by 5-hour windows
- Identify peak usage times
- Detect:
  - Rate limit proximity (high token usage in short windows)
  - Inefficient timing (late-night sessions with higher costs)

**Done When**:
- [ ] 5-hour window grouping correct
- [ ] Rate limit indicators reasonable
- [ ] Peak times identified

### 3.4 Subagent Opportunity Detector

**Algorithm**:
- Detect exploration chains: 5+ consecutive `Read` tools
- Detect large ingestion: reading files >50KB total without processing
- Suggest delegation to Explore subagent

**Done When**:
- [ ] Exploration chains detected
- [ ] Large unused ingestion flagged
- [ ] Suggestions provided

---

## Phase 4: Integration + Output (Days 12-13)

### 4.1 Detector Registry

**Tasks**:
- [ ] Create registry that runs all detectors
- [ ] Collect results into unified `AnalysisOutput`
- [ ] Sort by `savingsPercent` (descending)
- [ ] Filter by confidence threshold (>0.5)

**Done When**: All detectors run, results collected and sorted

### 4.2 JSON Output

**Schema**:
```json
{
  "metadata": {
    "generatedAt": "2026-03-27T10:30:00Z",
    "sessionCount": 145,
    "dateRange": { "start": "2026-02-25", "end": "2026-03-27" },
    "totalTokens": { "input": 1234567, "output": 234567, ... }
  },
  "findings": [
    {
      "detector": "context-snowball",
      "title": "Context Snowball",
      "severity": "high",
      "savingsPercent": 38,
      "savingsTokens": 456789,
      "confidence": 0.92,
      "evidence": { ... }
    }
  ]
}
```

**Done When**: Valid JSON output matching schema

### 4.3 Entry Point

**Tasks**:
- [ ] Implement `analyze.ts` CLI entry point
- [ ] Parse command-line flags: `--json`, `--days`, `--project`, `--verbose`
- [ ] Handle errors gracefully
- [ ] Stream output to stdout

**Done When**:
- `node dist/analyze.js --json` works
- All flags function correctly
- Error messages are helpful

### 4.4 End-to-End Test

**Tasks**:
- [ ] Run against real 30-day session history
- [ ] Verify all findings make sense
- [ ] Check for obvious false positives
- [ ] Validate performance (<3s)

**Done When**: Real-world usage produces valuable insights

---

## Phase 5: Plugin (Days 14-15)

### 5.1 SKILL.md Refinement

**Key Components**:
- [ ] Clear invocation: "Run this Bash command"
- [ ] JSON parsing instructions
- [ ] Coaching guidelines:
  - Use conversational tone
  - Reference specific sessions by name and date
  - Explain the "why" not just the "what"
  - Connect related patterns
  - Provide actionable advice
- [ ] Output clarity definitions (from implementation-plan.md Section 8)

**Done When**: Claude produces genuine coaching, not data dumps

### 5.2 Plugin Manifest

**plugin.json**:
```json
{
  "name": "tokenomics",
  "version": "1.0.0",
  "description": "Retroactive token intelligence for Claude Code",
  "author": "Your Name",
  "skills": ["tokenomics"]
}
```

**Done When**: Valid format for Claude Code marketplace

### 5.3 Build & Commit

**Tasks**:
- [ ] Run `npm run build` to generate `dist/analyze.js`
- [ ] Commit compiled bundle to repository
- [ ] Verify plugin works without npm build step

**Done When**: `/plugin install [repo]` works immediately

### 5.4 Plugin Install Test

**Tasks**:
- [ ] Test `/plugin install` from GitHub repo
- [ ] Test `/tokenomics` invocation
- [ ] Verify output appears in Claude conversation

**Done When**: Full plugin lifecycle works end-to-end

---

## Phase 6: Ship (Days 16-17)

### 6.1 Documentation

**README.md**:
- [ ] Installation instructions
- [ ] Quick start example
- [ ] What each detector finds
- [ ] Comparison with token-optimizer
- [ ] Example output (with session names redacted)

**PRIVACY.md**:
- [ ] Explicit statement: runs locally
- [ ] No data leaves machine
- [ ] No network calls
- [ ] No telemetry or tracking

**Done When**: Clear documentation for users

### 6.2 Release

**Tasks**:
- [ ] Tag v1.0.0 release
- [ ] Submit to Claude Code marketplace
- [ ] Prepare HN launch post
- [ ] Prepare community posts (Reddit, Twitter)

**Done When**: Publicly available and announced

---

## Pre-Build Checklist

Before starting implementation:

1. **Parse 5 diverse JSONL files**
   - Verify schema matches across Claude Code versions
   - Test different projects, sessions with/without compaction
   - Test chained sessions

2. **Run Detector 1 manually**
   - Pick one of your own sessions
   - Calculate inflection turn and waste estimate
   - Does it match your intuition?

3. **Test SKILL.md early**
   - After Phase 2, run with 2-3 detectors working
   - Verify Claude produces coaching, not data dumps

4. **Validate hypothesis**
   - Ask 2-3 developers: "Would this make you change your behavior?"
   - If no, problem is hypothesis, not engineering

---

## File-to-Scenario Traceability

| File | Scenario | Phase |
|------|----------|-------|
| `src/parser.ts` | Parse 30-day history, Handle malformed JSONL | 1 |
| `src/detectors/context-snowball.ts` | Identify context snowball, Distinguish cost impact | 2 |
| `src/detectors/claude-md-overhead.ts` | Detect oversized CLAUDE.md | 3 |
| `src/detectors/model-selection.ts` | Flag simple tasks using Opus | 2 |
| `src/detectors/vague-prompts.ts` | Identify vague prompts | 2 |
| `src/detectors/file-read-waste.ts` | Detect duplicate file reads | 2 |
| `src/analyze.ts` | Plugin installation & execution | 4 |
| All detectors | Ensure local-only execution | All |
| `SKILL.md` | Plugin installation & execution | 5 |

---

## Risk Mitigation

### JSONL Format Changes
- **Risk**: Claude Code updates change JSONL schema
- **Mitigation**: Test against multiple versions, graceful degradation

### False Positives
- **Risk**: Users lose trust if detectors are wrong
- **Mitigation**: Conservative thresholds, extensive testing with real data

### Claude Misinterpretation
- **Risk**: Claude doesn't understand JSON output
- **Mitigation**: Clear schema, extensive SKILL.md testing, example outputs

### Performance
- **Risk**: Analysis takes too long on large histories
- **Mitigation**: Streaming parser, --days filter, early performance testing

---

## Definition of Done

- [ ] All 9 detectors implemented and tested
- [ ] SKILL.md produces conversational coaching
- [ ] Plugin installs via `/plugin install`
- [ ] Analysis completes in <3s for 30 days
- [ ] Zero runtime dependencies
- [ ] TypeScript strict mode, no `any`
- [ ] 80%+ test coverage on detectors
- [ ] README and PRIVACY.md complete
- [ ] v1.0.0 tagged
- [ ] Real-world testing complete
- [ ] User feedback positive
