/**
 * Skill Analyzer Engine
 *
 * Analyzes an AI agent skill package directory for token efficiency.
 * Discovers skill files, runs all skill rules, and returns findings.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import type { SkillAnalysisContext, SkillAnalysisResult, SkillAnalysisSummary, SkillFinding, SkillRule } from './types.js'

// Import all rules
import * as promptSizeRule from './skill-rules/prompt-size.js'
import * as claudeMdSizeRule from './skill-rules/claude-md-size.js'
import * as toolOverheadRule from './skill-rules/tool-overhead.js'
import * as largeFilesRule from './skill-rules/large-files.js'
import * as redundantInstructionsRule from './skill-rules/redundant-instructions.js'

const CHARS_PER_TOKEN = 4

const SKILL_FILES = [
  'SKILL.md',
  'CLAUDE.md',
  'tank.json',
  'skills.json',
]

const SKILL_EXTENSIONS = ['.md', '.json']

const rules: SkillRule[] = [
  { name: 'prompt-size', analyze: promptSizeRule.analyze },
  { name: 'claude-md-size', analyze: claudeMdSizeRule.analyze },
  { name: 'tool-overhead', analyze: toolOverheadRule.analyze },
  { name: 'large-files', analyze: largeFilesRule.analyze },
  { name: 'redundant-instructions', analyze: redundantInstructionsRule.analyze },
]

function discoverSkillFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>()

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      // Skip symlinks to prevent path traversal
      if (entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
        walk(join(currentDir, entry.name))
        continue
      }

      const fullPath = join(currentDir, entry.name)
      const relativePath = relative(dir, fullPath)

      // Include known skill files or files with skill extensions
      const isKnownFile = SKILL_FILES.some(f => entry.name.toLowerCase() === f.toLowerCase())
      const isAtomFile = entry.name.toLowerCase().endsWith('.atom.md')
      const hasSkillExt = SKILL_EXTENSIONS.includes(extname(entry.name).toLowerCase())

      if (isKnownFile || isAtomFile || hasSkillExt) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          files.set(relativePath, content)
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(dir)
  return files
}

function loadManifest(files: Map<string, string>): Record<string, unknown> | null {
  // Try tank.json first, then skills.json
  for (const manifestName of ['tank.json', 'skills.json']) {
    for (const [filename, content] of files) {
      if (filename.toLowerCase().endsWith(manifestName.toLowerCase())) {
        try {
          return JSON.parse(content) as Record<string, unknown>
        } catch {
          // Invalid JSON, skip
        }
      }
    }
  }
  return null
}

function estimateTokens(files: Map<string, string>): number {
  let totalChars = 0
  for (const content of files.values()) {
    totalChars += content.length
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN)
}

function calculateEfficiencyScore(findings: SkillFinding[], totalTokens: number): number {
  // Start at 100, deduct points based on findings
  let score = 100

  for (const finding of findings) {
    const deduction = finding.severity === 'high' ? 15
      : finding.severity === 'medium' ? 8
      : finding.severity === 'low' ? 3
      : 1 // info
    score -= deduction
  }

  // Bonus for low total token count
  if (totalTokens < 1000) score = Math.min(score + 10, 100)

  return Math.max(0, Math.min(100, score))
}

export function analyzeSkill(dir: string): SkillAnalysisResult {
  // Validate directory
  if (!existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`)
  }

  if (!statSync(dir).isDirectory()) {
    throw new Error(`Not a directory: ${dir}`)
  }

  // Discover and read files
  const files = discoverSkillFiles(dir)
  const manifest = loadManifest(files)

  // Build analysis context
  const context: SkillAnalysisContext = {
    skillDir: dir,
    files,
    skillManifest: manifest,
  }

  // Run all rules
  const allFindings: SkillFinding[] = []
  for (const rule of rules) {
    const ruleFindings = rule.analyze(context)
    allFindings.push(...ruleFindings)
  }

  // Calculate summary
  const estimatedTokens = estimateTokens(files)
  const efficiencyScore = calculateEfficiencyScore(allFindings, estimatedTokens)

  const summary: SkillAnalysisSummary = {
    total_findings: allFindings.length,
    estimated_tokens_per_invocation: estimatedTokens,
    efficiency_score: efficiencyScore,
  }

  return {
    findings: allFindings,
    summary,
  }
}
