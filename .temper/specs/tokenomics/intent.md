# Tokenomics — Intent & Success Criteria

## Why Build This?

### Problem Statement

Claude Code users waste tokens through inefficient behavioral patterns:
- Context windows grow unboundedly (snowball effect)
- Oversized CLAUDE.md files add overhead to every message
- Suboptimal model selection for simple tasks
- Rarely-used MCP servers consume tokens without benefit
- Vague prompts require extensive clarification rounds

**Current solutions fail because:**
- They show numbers without intelligence
- They use generic heuristics that read like blog posts
- They lack historical depth (only work from install date forward)
- They can't provide personalized, contextual coaching

### Solution Hypothesis

**Claude analyzing your actual session data** will produce:
1. **Causal reasoning**: "Your snowballs happen in exploration sessions, not implementation sessions"
2. **Cross-pattern connections**: "Your context snowball + file re-reads happen together — the fix is earlier /compact"
3. **Personalized examples**: "In session 'sleepy-bubbling-fog' (March 5), you pivoted at turn 15 without clearing context"
4. **Behavioral coaching**: "Your most efficient sessions start with /plan — they cost 2.3x less"

### Success Validation

A user should say: "If this plugin told me my /compact habit cost 38% of my token budget with specific examples, I would change my behavior."

---

## Success Criteria

### Primary Metrics

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| **Token waste identified** | ≥40% savings potential | Sum of detector savings estimates |
| **False positive rate** | <15% at Month 1 | User-reported issues / total findings |
| **Analysis speed** | <3s for 30 days | p95 execution time |
| **Immediate value** | 100% historical coverage | Works on all JSONL files from day 1 |

### Secondary Metrics

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| **Plugin adoption** | 3,000 installs in Month 1 | Marketplace analytics |
| **User engagement** | Run at least once per week | Usage patterns |
| **Community response** | 2,000 GitHub stars in Month 1 | Repository metrics |
| **HN visibility** | Front page in Week 1 | Social proof |

### Quality Gates

- [ ] All 9 detectors produce meaningful findings
- [ ] Claude's coaching references specific sessions by name and date
- [ ] No network calls or data leaves the user's machine
- [ ] Zero runtime dependencies (pure Node.js)
- [ ] TypeScript strict mode with no `any` types
- [ ] 80%+ test coverage on detector logic
- [ ] Streaming parser handles unlimited session count

---

## BDD Scenarios

### Feature: JSONL Session Analysis

**Scenario: Parse 30-day session history**
```gherkin
Given I have used Claude Code for 30 days
And I have sessions across multiple projects
When I run /tokenomics
Then all JSONL files are discovered and parsed
And the analysis completes in <3 seconds
And I receive structured findings for all sessions
```

**Scenario: Handle malformed JSONL gracefully**
```gherkin
Given one session file contains corrupted JSON
When I run /tokenomics
Then the parser skips the malformed record
And continues processing remaining sessions
And logs a warning without crashing
```

### Feature: Context Snowball Detection

**Scenario: Identify context snowball pattern**
```gherkin
Given a session "valiant-dazzling-crayon" with 20 turns
And context grows from 5K tokens to 100K tokens
And the inflection turn is at turn 12
When the detector runs
Then it calculates excess context tokens after inflection
And it identifies topic shifts with Jaccard similarity
And it reports growth multiplier (20x)
And Claude explains: "By turn 12, you had 20x context growth"
```

**Scenario: Distinguish subscription vs API cost impact**
```gherkin
Given a user on Claude Code subscription
And a session with high cache_read_tokens
When the detector calculates waste
Then it provides excessContextTokens (rate-limit impact)
And it provides excessCostWeighted (API cost impact)
And Claude explains the difference correctly
```

### Feature: CLAUDE.md Overhead Detection

**Scenario: Detect oversized CLAUDE.md**
```gherkin
Given a CLAUDE.md file with 15,000 tokens
And it contains ESLint config duplication
When the detector runs
Then it estimates token cost per session
And it identifies duplicate config keywords
And Claude suggests: "Move ESLint rules to .eslintrc, reduce CLAUDE.md by 8,000 tokens"
```

### Feature: Model Selection Analysis

**Scenario: Flag simple tasks using Opus**
```gherkin
Given a session using claude-opus-4-6
And the session has <5 tool uses
And all tools are Read/Edit commands
When the detector runs
Then it classifies the session as "sonnet-sufficient"
And it calculates the cost difference (3-5x)
And Claude suggests: "This refactoring could use Sonnet, saving ~$X"
```

### Feature: Vague Prompt Detection

**Scenario: Identify vague prompts requiring clarification**
```gherkin
Given a user prompt "fix the bug"
And Claude's response requires 3 clarification questions
And the session outcome is not CLEAN
When the detector runs
Then it flags the prompt as vague
And it mines positive examples from successful sessions
And Claude coaches: "Be specific — 'fix the NPE in UserService.login'"
```

### Feature: File Read Waste

**Scenario: Detect duplicate file reads**
```gherkin
Given a session reads "config.json" 5 times
And the file was not modified between reads
When the detector runs
Then it identifies duplicate reads
And it calculates the wasted tokens
And Claude suggests: "Cache config.json in memory, avoid 4 re-reads"
```

### Feature: Plugin Installation & Execution

**Scenario: Install and run tokenomics**
```gherkin
Given I have Claude Code installed
When I run /plugin install github.com/user/tokenomics
Then the plugin is installed to ~/.claude/skills/tokenomics/
And dist/analyze.js is pre-compiled
When I run /tokenomics
Then Claude executes the SKILL.md
And I receive personalized coaching based on my sessions
```

### Feature: Privacy & Security

**Scenario: Ensure local-only execution**
```gherkin
Given I run /tokenomics
When the analysis executes
Then no network requests are made
And no data is sent to external servers
And all processing happens on my local machine
And no API keys are required beyond Claude Code's session
```

---

## Anti-Goals

### What This Tool Does NOT Do

1. **Real-time optimization**: Not a hook-based in-session tool (that's token-optimizer's job)
2. **Payment processing**: No billing, subscriptions, or payment integration
3. **Multi-user analytics**: No dashboards, teams, or aggregation across users
4. **Automated fixes**: Provides coaching, not automatic remediation
5. **API key management**: No embedded keys or external API calls

### What We're NOT Optimizing For

- **Startup time**: 2-3 second analysis is acceptable
- **Memory efficiency**: 100MB for 30 days is fine
- **Perfect accuracy**: <15% false positives is good enough for behavioral coaching
- **Enterprise features**: No SSO, RBAC, or compliance reporting

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| JSONL format changes | Medium | High | Test against multiple Claude Code versions |
| Parser performance on huge histories | Low | Medium | Streaming parser, --days filter |
| False positives damage trust | High | High | Conservative thresholds, user feedback loop |
| Claude misinterprets JSON output | Medium | High | Clear schema, extensive SKILL.md testing |

### Product Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Users don't change behavior | Medium | High | Focus on specific examples, not generic advice |
| Competitor copies approach | High | Low | First-mover advantage, community trust |
| Low adoption | Medium | High | HN launch, clear differentiation, immediate value |
| Privacy concerns | Low | High | Explicit PRIVACY.md, local-only guarantee |

---

## Definition of Done

- [ ] All 9 detectors implemented and tested
- [ ] SKILL.md produces conversational coaching (not just data dumps)
- [ ] Plugin installs via `/plugin install` without build steps
- [ ] Analysis completes in <3s for 30 days
- [ ] Zero false positives in test fixtures
- [ ] README with install instructions and examples
- [ ] PRIVACY.md explicitly stating local-only execution
- [ ] v1.0.0 tagged and ready for marketplace submission
- [ ] Tested against real 30-day session history
- [ ] User feedback: "This would make me change my behavior"
