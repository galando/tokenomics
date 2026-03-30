# Tokenomics — Feature Planning Summary

**Generated**: 2026-03-27
**Status**: READY FOR IMPLEMENTATION
**Complexity**: MEDIUM

---

## What is Tokenomics?

Tokenomics is a Claude Code plugin that analyzes your complete session history, identifies behavioral patterns that waste tokens, and provides personalized coaching to reduce API costs.

**Key Differentiator**: Uses Claude itself as the intelligence layer, providing causal reasoning, cross-pattern connections, and specific session examples that generic tools cannot match.

---

## Quick Links

- **[spec.md](spec.md)** — Complete feature specification
- **[intent.md](intent.md)** — Success criteria and BDD scenarios
- **[plan.md](plan.md)** — 17-day implementation plan
- **[quickstart.md](quickstart.md)** — Development setup guide

---

## Core Value Propositions

| Aspect | Value |
|--------|-------|
| **Cost** | Zero extra API cost (uses existing subscription) |
| **Depth** | Retroactive analysis from day one |
| **Quality** | Claude-powered personalized coaching |
| **Speed** | <3s for 30-day analysis |
| **Privacy** | 100% local execution |

---

## The 9 Detectors

1. **Context Snowball** — Unbounded context growth (40% savings potential)
2. **CLAUDE.md Overhead** — Oversized config duplication
3. **Model Selection** — Suboptimal model choices (3-5x cost differences)
4. **MCP Tool Tax** — Rarely-used servers with token overhead
5. **Vague Prompts** — Prompts requiring clarification rounds
6. **Session Timing** — Time-based efficiency patterns
7. **File Read Waste** — Unnecessary file re-reads
8. **Bash Output Bloat** — Excessive command output
9. **Subagent Opportunity** — Delegation opportunities

---

## Implementation Timeline

```
Week 1 (Days 1-3):    Foundation
Week 2 (Days 4-8):    High-Impact Detectors
Week 3 (Days 9-11):   Remaining Detectors
Week 3 (Days 12-13):  Integration & Output
Week 3 (Days 14-15):  Plugin Development
Week 3 (Days 16-17):  Documentation & Launch
```

---

## Technology Stack

- **Language**: TypeScript (strict mode, ESM)
- **Build**: tsup
- **Testing**: Vitest
- **Runtime**: Node.js >=18
- **Dependencies**: Zero (pure Node.js)

---

## Success Metrics

| Metric | Week 1 | Month 1 |
|--------|--------|---------|
| GitHub stars | 200 | 2,000 |
| Plugin installs | 300 | 3,000 |
| Analysis time (p95) | <3s | <3s |
| False positives | <30% | <15% |

---

## Key Risks

| Risk | Mitigation |
|------|------------|
| JSONL format changes | Test multiple versions |
| False positives | Conservative thresholds |
| Claude misinterprets output | Clear JSON schema |
| Performance issues | Streaming parser |

---

## Pre-Build Validation

Before starting implementation, validate:

1. **Parse 5 diverse JSONL files** — Verify schema across versions
2. **Run Detector 1 manually** — Does it match intuition?
3. **Test SKILL.md early** — After Phase 2, verify coaching quality
4. **Validate hypothesis** — "Would this make you change behavior?"

---

## File Structure

```
tokenomics/
├── src/
│   ├── analyze.ts           # Entry point
│   ├── parser.ts            # JSONL parser
│   ├── types.ts             # TypeScript interfaces
│   └── detectors/           # 9 detector modules
├── tests/
│   ├── fixtures/            # Test sessions
│   └── detectors/           # Detector tests
├── dist/
│   └── analyze.js           # Compiled bundle
├── SKILL.md                 # Plugin definition
├── plugin.json              # Marketplace manifest
└── package.json
```

---

## Differentiation from token-optimizer

| Aspect | token-optimizer | Tokenomics |
|--------|----------------|------------|
| Data source | Hooks (from install) | JSONL (all history) |
| Timing | Real-time | Retroactive |
| Focus | Config overhead | Behavioral patterns |
| Value delivery | After 1+ sessions | Immediate |

**These tools are complementary.** Use both.

---

## Next Steps

1. ✅ Read this summary
2. 📖 Review [spec.md](spec.md) for detailed specification
3. 🎯 Review [intent.md](intent.md) for success criteria
4. 📋 Review [plan.md](plan.md) for implementation phases
5. 🚀 Review [quickstart.md](quickstart.md) for setup
6. 💻 Begin Phase 1: Foundation

---

## Questions?

- **What does this do?** Analyzes your Claude Code sessions and coaches you on token efficiency
- **How does it work?** Plugin runs Node.js script, Claude analyzes structured JSON findings
- **Is it private?** Yes, 100% local execution, no network calls
- **When can I use it?** After 17-day implementation cycle
- **Why "tokenomics"?** Economics of token usage — how you spend your token budget

---

## Definition of Done

- [ ] All 9 detectors implemented and tested
- [ ] SKILL.md produces conversational coaching
- [ ] Plugin installs via `/plugin install`
- [ ] Analysis <3s for 30 days
- [ ] Zero runtime dependencies
- [ ] TypeScript strict mode
- [ ] 80%+ test coverage
- [ ] Documentation complete
- [ ] v1.0.0 tagged
- [ ] Real-world tested
- [ ] User feedback positive
