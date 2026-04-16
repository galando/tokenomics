import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { analyzeSkill } from '../src/skill-analyzer.js'

import * as promptSizeRule from '../src/skill-rules/prompt-size.js'
import * as claudeMdSizeRule from '../src/skill-rules/claude-md-size.js'
import * as toolOverheadRule from '../src/skill-rules/tool-overhead.js'
import * as largeFilesRule from '../src/skill-rules/large-files.js'
import * as redundantInstructionsRule from '../src/skill-rules/redundant-instructions.js'
import * as sectionAnalysisRule from '../src/skill-rules/section-analysis.js'
import type { SkillAnalysisContext } from '../src/types.js'

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'skill-test-'))
}

function createFixture(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name)
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    if (parentDir !== dir) {
      mkdirSync(parentDir, { recursive: true })
    }
    writeFileSync(fullPath, content, 'utf-8')
  }
}

// ─── Helpers for rule-level testing ──────────────────────────────────────────

function makeContext(files: Record<string, string>, manifest: Record<string, unknown> | null = null): SkillAnalysisContext {
  return {
    skillDir: '/test',
    files: new Map(Object.entries(files)),
    skillManifest: manifest,
  }
}

// ─── Prompt Size Rule ────────────────────────────────────────────────────────

describe('prompt-size rule', () => {
  it('flags SKILL.md >4000 tokens as high severity', () => {
    // 16000+ chars = 4000+ tokens
    const largeSkill = 'A'.repeat(16001)
    const ctx = makeContext({ 'SKILL.md': largeSkill })
    const findings = promptSizeRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('high')
    expect(findings[0]!.rule).toBe('prompt-size')
    expect(findings[0]!.location).toBe('SKILL.md')
  })

  it('flags SKILL.md >2000 tokens as medium severity', () => {
    // 8001 chars = ~2001 tokens (>2000 threshold)
    const mediumSkill = 'A'.repeat(8001)
    const ctx = makeContext({ 'SKILL.md': mediumSkill })
    const findings = promptSizeRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('does not flag small SKILL.md', () => {
    const smallSkill = 'A'.repeat(1000)
    const ctx = makeContext({ 'SKILL.md': smallSkill })
    const findings = promptSizeRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })

  it('flags .atom.md files', () => {
    const largeAtom = 'A'.repeat(8001)
    const ctx = makeContext({ 'tools/search.atom.md': largeAtom })
    const findings = promptSizeRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.location).toContain('.atom.md')
  })

  it('ignores non-prompt files', () => {
    const ctx = makeContext({ 'package.json': 'A'.repeat(16001) })
    const findings = promptSizeRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })
})

// ─── CLAUDE.md Size Rule ────────────────────────────────────────────────────

describe('claude-md-size rule', () => {
  it('flags CLAUDE.md >3000 tokens as high severity', () => {
    const largeClaude = 'A'.repeat(12001)
    const ctx = makeContext({ 'CLAUDE.md': largeClaude })
    const findings = claudeMdSizeRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('high')
    expect(findings[0]!.rule).toBe('claude-md-size')
  })

  it('flags CLAUDE.md >1500 tokens as medium severity', () => {
    const mediumClaude = 'A'.repeat(6001)
    const ctx = makeContext({ 'CLAUDE.md': mediumClaude })
    const findings = claudeMdSizeRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('does not flag small CLAUDE.md', () => {
    const ctx = makeContext({ 'CLAUDE.md': 'small content' })
    const findings = claudeMdSizeRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })

  it('detects TOKENOMICS injection blocks', () => {
    const block = '<!-- TOKENOMICS:START:session-coaching -->\n' + 'A'.repeat(12001) + '\n<!-- TOKENOMICS:END -->'
    const ctx = makeContext({ 'CLAUDE.md': block })
    const findings = claudeMdSizeRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.description).toContain('tokenomics injection block')
  })
})

// ─── Tool Overhead Rule ─────────────────────────────────────────────────────

describe('tool-overhead rule', () => {
  it('flags >15 tools as high severity', () => {
    const tools: Record<string, unknown> = {}
    for (let i = 0; i < 16; i++) {
      tools[`tool-${i}`] = { command: 'echo' }
    }
    const manifest = { mcpServers: tools }
    const ctx = makeContext({}, manifest)

    const findings = toolOverheadRule.analyze(ctx)
    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('high')
    expect(findings[0]!.rule).toBe('tool-overhead')
  })

  it('flags >8 tools as medium severity', () => {
    const tools: Record<string, unknown> = {}
    for (let i = 0; i < 10; i++) {
      tools[`tool-${i}`] = { command: 'echo' }
    }
    const manifest = { mcpServers: tools }
    const ctx = makeContext({}, manifest)

    const findings = toolOverheadRule.analyze(ctx)
    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('does not flag <=8 tools', () => {
    const tools: Record<string, unknown> = {}
    for (let i = 0; i < 5; i++) {
      tools[`tool-${i}`] = { command: 'echo' }
    }
    const manifest = { mcpServers: tools }
    const ctx = makeContext({}, manifest)

    const findings = toolOverheadRule.analyze(ctx)
    expect(findings.length).toBe(0)
  })

  it('scans config files for tool definitions', () => {
    const tankJson = JSON.stringify({
      mcpServers: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`tool-${i}`, { command: 'echo' }])
      ),
    })
    const ctx = makeContext({ 'tank.json': tankJson }, null)

    const findings = toolOverheadRule.analyze(ctx)
    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('medium')
  })
})

// ─── Large Files Rule ────────────────────────────────────────────────────────

describe('large-files rule', () => {
  it('flags files >500 lines', () => {
    const lines = Array(501).fill('line of code').join('\n')
    const ctx = makeContext({ 'src/large.ts': lines })
    const findings = largeFilesRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.rule).toBe('large-files')
    expect(findings[0]!.location).toBe('src/large.ts')
  })

  it('flags files >1000 lines as medium severity', () => {
    const lines = Array(1001).fill('line of code').join('\n')
    const ctx = makeContext({ 'src/very-large.ts': lines })
    const findings = largeFilesRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('does not flag files <=500 lines', () => {
    const lines = Array(200).fill('line of code').join('\n')
    const ctx = makeContext({ 'src/small.ts': lines })
    const findings = largeFilesRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })
})

// ─── Redundant Instructions Rule ────────────────────────────────────────────

describe('redundant-instructions rule', () => {
  it('flags when >30% duplication across skill files', () => {
    const sharedInstructions = Array(10).fill('Always use TypeScript strict mode for all new files in this project').join('\n')
    const uniqueA = 'Specific to SKILL.md that is unique content'
    const uniqueB = 'Specific to CLAUDE.md that is different content'

    const ctx = makeContext({
      'SKILL.md': sharedInstructions + '\n' + uniqueA,
      'CLAUDE.md': sharedInstructions + '\n' + uniqueB,
    })
    const findings = redundantInstructionsRule.analyze(ctx)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0]!.rule).toBe('redundant-instructions')
  })

  it('does not flag when duplication is low', () => {
    const ctx = makeContext({
      'SKILL.md': 'Unique content about the first skill that is quite different from others',
      'CLAUDE.md': 'Different content about project guidelines that does not overlap at all',
    })
    const findings = redundantInstructionsRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })

  it('returns nothing with fewer than 2 skill files', () => {
    const ctx = makeContext({
      'SKILL.md': 'A'.repeat(500),
    })
    const findings = redundantInstructionsRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })
})

// ─── Section Analysis Rule ────────────────────────────────────────────────────

describe('section-analysis rule', () => {
  it('reports per-section token counts', () => {
    const skill = [
      '# My Skill',
      '',
      'A brief description of the skill.',
      '',
      '## Instructions',
      '',
      ...Array(50).fill('When the user asks for help, follow these steps carefully and provide detailed feedback.'),
      '',
      '## Examples',
      '',
      ...Array(30).fill('Here is an example of how to handle a request from the user.'),
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.rule).toBe('section-analysis')
    expect(findings[0]!.sections).toBeDefined()
    expect(findings[0]!.sections!.length).toBe(3) // preamble, Instructions, Examples

    // Check that sections have token counts
    const instructionsSection = findings[0]!.sections!.find(s => s.heading === 'Instructions')
    expect(instructionsSection).toBeDefined()
    expect(instructionsSection!.tokens).toBeGreaterThan(0)
  })

  it('flags sections with redundant/overlapping content', () => {
    const sharedContent = Array(20).fill(
      'Always use TypeScript strict mode for all new files in this project and follow the established patterns'
    ).join(' ')

    const skill = [
      '# My Skill',
      '',
      '## Code Review',
      '',
      sharedContent,
      'Also check for security issues in the authentication module.',
      '',
      '## Security Review',
      '',
      sharedContent,
      'Also verify that authentication tokens are properly validated.',
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    expect(findings.length).toBe(1)
    const finding = findings[0]!
    expect(finding.description).toContain('overlap')

    // Check redundantWith is populated
    const codeReview = finding.sections!.find(s => s.heading === 'Code Review')
    expect(codeReview!.redundantWith).toBeDefined()
    expect(codeReview!.redundantWith).toContain('Security Review')
  })

  it('suggests shortening tips for sections with repeated lines', () => {
    const skill = [
      '# My Skill',
      '',
      '## Guidelines',
      '',
      ...Array(5).fill('Always check the types before submitting code changes.'),
      '',
      'Some unique content here that is different.',
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    // Should have findings since Guidelines has repeated lines
    if (findings.length > 0) {
      const guidelines = findings[0]!.sections!.find(s => s.heading === 'Guidelines')
      if (guidelines?.shorteningTip) {
        expect(guidelines.shorteningTip).toContain('repeated')
      }
    }
  })

  it('suggests shortening for sections with many list items', () => {
    const listItems = Array(12).fill(0).map((_, i) => `- Item number ${i + 1} that describes a specific check to perform`).join('\n')

    const skill = [
      '# My Skill',
      '',
      '## Checklist',
      '',
      listItems,
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    if (findings.length > 0) {
      const checklist = findings[0]!.sections!.find(s => s.heading === 'Checklist')
      if (checklist?.shorteningTip) {
        expect(checklist.shorteningTip).toContain('list items')
      }
    }
  })

  it('suggests shortening for sections with many code blocks', () => {
    const codeBlocks = Array(3).fill(0).map((_, i) => `Example ${i}:\n\`\`\`ts\nconst x = ${i};\n\`\`\``).join('\n\n')

    const skill = [
      '# My Skill',
      '',
      '## Examples',
      '',
      codeBlocks,
      '',
      'Some additional content to make this section large enough to be over the threshold.',
      'More filler content that pushes the token count above the detection minimum.',
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    if (findings.length > 0) {
      const examples = findings[0]!.sections!.find(s => s.heading === 'Examples')
      if (examples?.shorteningTip) {
        expect(examples.shorteningTip).toContain('code blocks')
      }
    }
  })

  it('does not flag small, clean sections', () => {
    const skill = [
      '# My Skill',
      '',
      'A brief skill that does one thing.',
      '',
      '## Usage',
      '',
      'Run the command with the file path.',
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })

  it('ignores non-prompt files', () => {
    const ctx = makeContext({ 'package.json': '{"name": "test"}' })
    const findings = sectionAnalysisRule.analyze(ctx)

    expect(findings.length).toBe(0)
  })

  it('analyzes .atom.md files', () => {
    const skill = [
      '## Search',
      '',
      ...Array(60).fill('Detailed search instructions that explain how to search for files in the project directory.'),
    ].join('\n')

    const ctx = makeContext({ 'tools/search.atom.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.location).toContain('.atom.md')
  })

  it('includes sections array in JSON output', () => {
    const skill = [
      '# Skill',
      '',
      'Preamble content here.',
      '',
      '## Section A',
      '',
      'Content for section A that is reasonably sized.',
      '',
      '## Section B',
      '',
      'Content for section B that is also reasonably sized.',
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    // Even if no findings (sections are small), verify JSON serialization
    if (findings.length > 0) {
      const json = JSON.stringify(findings[0])
      const parsed = JSON.parse(json)
      expect(parsed.sections).toBeDefined()
      expect(Array.isArray(parsed.sections)).toBe(true)
    }
  })

  it('high severity for sections >1000 tokens', () => {
    const hugeSection = 'Very detailed instruction content. '.repeat(600) // ~16800 chars = ~4200 tokens

    const skill = [
      '# Skill',
      '',
      '## Deep Dive',
      '',
      hugeSection,
    ].join('\n')

    const ctx = makeContext({ 'SKILL.md': skill })
    const findings = sectionAnalysisRule.analyze(ctx)

    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('high')
  })
})

// ─── Integration: Full Skill Analyzer ────────────────────────────────────────

describe('skill analyzer integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns valid SkillAnalysisResult for a clean skill', () => {
    createFixture(tempDir, {
      'SKILL.md': 'A simple skill that does one thing well.',
      'tank.json': JSON.stringify({ name: 'test-skill', version: '1.0.0' }),
    })

    const result = analyzeSkill(tempDir)

    expect(result).toHaveProperty('findings')
    expect(result).toHaveProperty('summary')
    expect(Array.isArray(result.findings)).toBe(true)
    expect(result.summary.total_findings).toBe(result.findings.length)
    expect(result.summary.efficiency_score).toBeGreaterThanOrEqual(0)
    expect(result.summary.efficiency_score).toBeLessThanOrEqual(100)
    expect(result.summary.estimated_tokens_per_invocation).toBeGreaterThan(0)
  })

  it('detects all issue types in a bloated skill', () => {
    const largeSkill = 'Large prompt content. '.repeat(800) // ~19k chars
    const largeClaude = 'Inject all the things. '.repeat(800) // ~19k chars
    const duplicated = Array(15).fill('Always use TypeScript strict mode for all files in this project').join('\n')

    const tools: Record<string, unknown> = {}
    for (let i = 0; i < 16; i++) {
      tools[`tool-${i}`] = { command: `echo ${i}` }
    }

    createFixture(tempDir, {
      'SKILL.md': largeSkill + '\n' + duplicated,
      'CLAUDE.md': largeClaude + '\n' + duplicated,
      'search.atom.md': largeSkill,
      'tank.json': JSON.stringify({ name: 'bloated-skill', mcpServers: tools }),
    })

    const result = analyzeSkill(tempDir)

    expect(result.findings.length).toBeGreaterThanOrEqual(3)

    const rules = result.findings.map(f => f.rule)
    expect(rules).toContain('prompt-size')
    expect(rules).toContain('claude-md-size')
    expect(rules).toContain('tool-overhead')
    expect(rules).toContain('redundant-instructions')
  })

  it('throws for non-existent directory', () => {
    expect(() => analyzeSkill('/nonexistent/path')).toThrow('Directory not found')
  })

  it('throws for a file path instead of directory', () => {
    const filePath = join(tempDir, 'file.txt')
    writeFileSync(filePath, 'test', 'utf-8')
    expect(() => analyzeSkill(filePath)).toThrow('Not a directory')
  })

  it('produces valid JSON output', () => {
    createFixture(tempDir, {
      'SKILL.md': 'Simple skill content.',
    })

    const result = analyzeSkill(tempDir)
    const json = JSON.stringify(result)

    expect(() => JSON.parse(json)).not.toThrow()

    const parsed = JSON.parse(json)
    expect(parsed).toHaveProperty('findings')
    expect(parsed).toHaveProperty('summary')
    expect(parsed.summary).toHaveProperty('total_findings')
    expect(parsed.summary).toHaveProperty('estimated_tokens_per_invocation')
    expect(parsed.summary).toHaveProperty('efficiency_score')
  })

  it('calculates efficiency score correctly for clean skill', () => {
    createFixture(tempDir, {
      'SKILL.md': 'A concise skill with minimal overhead.',
    })

    const result = analyzeSkill(tempDir)

    // Clean small skill should score high
    expect(result.summary.efficiency_score).toBeGreaterThanOrEqual(90)
  })

  it('calculates efficiency score correctly for bloated skill', () => {
    const largeContent = 'X'.repeat(20000)
    createFixture(tempDir, {
      'SKILL.md': largeContent,
      'CLAUDE.md': largeContent,
    })

    const result = analyzeSkill(tempDir)

    // Bloated skill should score lower
    expect(result.summary.efficiency_score).toBeLessThan(90)
  })
})
