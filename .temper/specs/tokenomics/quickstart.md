# Tokenomics — Quick Start Guide

## Prerequisites

- Node.js >=18
- Claude Code installed
- Git

---

## Initial Setup

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/tokenomics.git
cd tokenomics
npm install
```

### 2. Build the Plugin

```bash
npm run build
```

This generates `dist/analyze.js` — the compiled bundle that Claude Code will execute.

### 3. Verify Build

```bash
node dist/analyze.js --help
```

Expected output:
```
Tokenomics - Retroactive Token Intelligence

Usage: node analyze.js [options]

Options:
  --json       Output JSON format (required for plugin)
  --days N     Analyze last N days (default: 30)
  --project P  Filter to specific project path
  --verbose    Include technical details
  --help       Show this message
```

---

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run specific detector test
npm test -- context-snowball.test.ts

# Run with coverage
npm run test:coverage
```

### Development Mode

```bash
# Watch mode for development
npm run dev

# In another terminal, test changes
node dist/analyze.js --json --days 7
```

### Testing Against Real Data

```bash
# Test with your own sessions (last 7 days)
node dist/analyze.js --json --days 7 | jq '.findings[0]'

# Test specific project
node dist/analyze.js --json --project /path/to/your/project

# Verbose output for debugging
node dist/analyze.js --json --verbose --days 1
```

---

## Testing Individual Detectors

### Unit Test Pattern

Each detector has corresponding test file:

```typescript
// tests/detectors/context-snowball.test.ts
import { describe, it, expect } from 'vitest';
import { detectContextSnowball } from '../../src/detectors/context-snowball';
import { loadFixture } from '../helpers';

describe('Context Snowball Detector', () => {
  it('detects snowball in fixture', () => {
    const session = loadFixture('context-snowball-session.jsonl');
    const result = detectContextSnowball(session);

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('high');
    expect(result?.evidence.inflectionTurn).toBe(12);
  });
});
```

### Running Detector Tests

```bash
# Test all detectors
npm test -- detectors/

# Test specific detector
npm test -- context-snowball.test.ts
```

---

## Plugin Installation

### Local Testing

```bash
# Link for local testing
npm link

# In Claude Code
/plugin install /path/to/tokenomics
/tokenomics
```

### From GitHub

```bash
# In Claude Code
/plugin install https://github.com/yourusername/tokenomics
/tokenomics
```

---

## Project Structure

```
tokenomics/
├── src/
│   ├── analyze.ts              # Entry point (CLI)
│   ├── parser.ts               # JSONL streaming parser
│   ├── types.ts                # TypeScript interfaces
│   ├── utils.ts                # Shared utilities
│   └── detectors/              # 9 detector modules
│       ├── context-snowball.ts
│       ├── claude-md-overhead.ts
│       ├── model-selection.ts
│       ├── mcp-tool-tax.ts
│       ├── vague-prompts.ts
│       ├── session-timing.ts
│       ├── file-read-waste.ts
│       ├── bash-output-bloat.ts
│       └── subagent-opportunity.ts
├── tests/
│   ├── fixtures/               # Test session files
│   │   ├── context-snowball-session.jsonl
│   │   ├── large-claudemd-session.jsonl
│   │   └── ...
│   ├── helpers.ts              # Test utilities
│   └── detectors/              # Detector tests
│       ├── context-snowball.test.ts
│       └── ...
├── dist/
│   └── analyze.js              # Compiled bundle
├── SKILL.md                    # Plugin definition
├── plugin.json                 # Marketplace manifest
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## Key Implementation Files

### 1. Entry Point (`src/analyze.ts`)

```typescript
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { discoverSessions } from './parser.js';
import { runAllDetectors } from './detectors/registry.js';

const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    days: { type: 'string', default: '30' },
    project: { type: 'string' },
    verbose: { type: 'boolean' },
    help: { type: 'boolean' }
  }
});

const sessions = await discoverSessions({
  days: parseInt(values.days),
  project: values.project
});

const findings = runAllDetectors(sessions);

console.log(JSON.stringify({
  metadata: { ... },
  findings
}, null, values.verbose ? 2 : 0));
```

### 2. Parser (`src/parser.ts`)

```typescript
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function* parseJSONL(filepath: string) {
  const rl = createInterface({
    input: createReadStream(filepath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch (e) {
      console.error(`Skipping malformed line: ${e.message}`);
    }
  }
}
```

### 3. Detector Pattern (`src/detectors/*.ts`)

```typescript
import { SessionData, DetectorResult } from '../types.js';

export function detectContextSnowball(session: SessionData): DetectorResult | null {
  // 1. Check minimum requirements
  if (session.turnCount < 5) return null;

  // 2. Run detection algorithm
  const contextSeries = session.messages
    .filter(m => m.role === 'assistant')
    .map(m => m.totalContext);

  // ... detection logic ...

  // 3. Return structured result
  return {
    detector: 'context-snowball',
    title: 'Context Snowball',
    severity: calculateSeverity(sessionsWithSnowball, compactRate),
    savingsPercent: calculateSavings(excessTokens, totalTokens),
    savingsTokens: excessTokens,
    confidence: 0.92,
    evidence: {
      sessionsWithSnowball,
      avgInflectionTurn,
      worstSessions: top5Sessions
    }
  };
}
```

---

## Debugging Tips

### Check JSONL Files

```bash
# Find your session files
find ~/.claude/projects -name "*.jsonl" | head -5

# Inspect one file
head -20 ~/.claude/projects/your-project/sessions/session-2026-03-27.jsonl

# Count sessions
find ~/.claude/projects -name "*.jsonl" | wc -l
```

### Debug Parser

```typescript
// Add to parser.ts temporarily
console.error(`Parsing ${filepath}, line ${lineNumber}`);
console.error(`Record type: ${record.type}`);
```

### Debug Detector

```typescript
// Add to detector file temporarily
console.error(`Session ${session.id}: context series =`, contextSeries);
console.error(`Inflection at turn ${inflectionIdx}`);
```

### Verbose Output

```bash
# Use --verbose flag
node dist/analyze.js --json --verbose --days 1 2>debug.log
```

---

## Testing Checklist

Before committing:

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Works on real data: `node dist/analyze.js --json --days 7`
- [ ] JSON is valid: `node dist/analyze.js --json | jq '.'`
- [ ] No console errors in verbose mode
- [ ] Performance acceptable (<3s for 30 days)

---

## Common Issues

### Issue: "Cannot find module"

**Solution**: Run `npm run build` to compile TypeScript

### Issue: "Permission denied"

**Solution**: Ensure `dist/analyze.js` has execute permissions:
```bash
chmod +x dist/analyze.js
```

### Issue: "No JSONL files found"

**Solution**: Check `~/.claude/projects/` exists and contains session files:
```bash
ls -la ~/.claude/projects/*/sessions/
```

### Issue: Parser fails on specific file

**Solution**: Inspect the file for malformed JSON:
```bash
cat file.jsonl | jq '.' > /dev/null
```

---

## Next Steps

1. Read `spec.md` for full feature specification
2. Read `intent.md` for success criteria and BDD scenarios
3. Read `plan.md` for implementation phases
4. Start with Phase 1: Foundation setup
5. Test early with real session data

---

## Getting Help

- Check existing issues: `https://github.com/yourusername/tokenomics/issues`
- Review test fixtures: `tests/fixtures/*.jsonl`
- Consult original implementation plan: `implementation-plan.md` (source of truth for algorithms)
