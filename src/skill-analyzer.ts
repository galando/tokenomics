/**
 * Skill Analyzer Engine
 *
 * Analyzes an AI agent skill package directory for token efficiency.
 * Discovers skill files, runs all skill rules, and returns findings.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import type { SkillAnalysisContext, SkillAnalysisReport, SkillAnalysisSummary, SkillCostEstimate, SkillFinding, SkillGrade, SkillRule } from './types.js'

// Import all rules
import * as promptSizeRule from './skill-rules/prompt-size.js'
import * as claudeMdSizeRule from './skill-rules/claude-md-size.js'
import * as toolOverheadRule from './skill-rules/tool-overhead.js'
import * as largeFilesRule from './skill-rules/large-files.js'
import * as redundantInstructionsRule from './skill-rules/redundant-instructions.js'
import * as sectionAnalysisRule from './skill-rules/section-analysis.js'

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
  { name: 'section-analysis', analyze: sectionAnalysisRule.analyze },
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

// ── Cost estimation ──────────────────────────────────────────────────────────

// Approximate USD per 1M input tokens (as of 2026)
const SONNET_INPUT_PER_M = 3.00
const OPUS_INPUT_PER_M = 15.00

const AVG_SKILL_TOKENS = 20000

function estimateCost(tokens: number): SkillCostEstimate {
  const tokenMillions = tokens / 1_000_000

  const sonnetCost = tokenMillions * SONNET_INPUT_PER_M
  const opusCost = tokenMillions * OPUS_INPUT_PER_M

  return {
    sonnet_context_load: formatUsd(sonnetCost),
    opus_context_load: formatUsd(opusCost),
    token_count: tokens,
    pricing_note: `Based on input pricing: $${SONNET_INPUT_PER_M}/M (Sonnet), $${OPUS_INPUT_PER_M}/M (Opus). Actual cost depends on how the skill is loaded, cache behavior, and session length.`,
  }
}

function formatUsd(amount: number): string {
  if (amount < 0.001) return '<$0.001'
  if (amount < 0.01) return `~$${amount.toFixed(3)}`
  if (amount < 0.1) return `~$${amount.toFixed(2)}`
  if (amount < 1) return `~$${amount.toFixed(2)}`
  return `~$${amount.toFixed(2)}`
}

// ── Grading ──────────────────────────────────────────────────────────────────

function calculateGrade(score: number): SkillGrade {
  if (score >= 85) return 'A'
  if (score >= 65) return 'B'
  if (score >= 40) return 'C'
  return 'D'
}

function calculateEfficiencyScore(findings: SkillFinding[], totalTokens: number): number {
  let score = 100

  for (const finding of findings) {
    const deduction = finding.severity === 'high' ? 15
      : finding.severity === 'medium' ? 8
      : finding.severity === 'low' ? 3
      : 1 // info
    score -= deduction
  }

  if (totalTokens < 1000) score = Math.min(score + 10, 100)

  return Math.max(0, Math.min(100, score))
}

// ── Plain-English summaries ──────────────────────────────────────────────────

function generateOneLiner(grade: SkillGrade, tokens: number, findingsCount: number): string {
  if (grade === 'A' && tokens < 5000) return 'Lean and efficient. No meaningful improvements needed.'
  if (grade === 'A') return 'Well-structured skill with no significant waste.'
  if (grade === 'B') {
    if (findingsCount <= 2) return 'Slightly above average size. Works fine, could be leaner.'
    return 'Good shape overall, with a few areas that could be tightened up.'
  }
  if (grade === 'C') return 'Carries noticeable token overhead. Several sections could be trimmed or consolidated.'
  return 'Bloated — significant token waste. Multiple sections duplicate content or over-explain.'
}

function generateComparison(tokens: number): string {
  const ratio = tokens / AVG_SKILL_TOKENS
  if (ratio < 0.3) return `${tokens.toLocaleString()} tokens — much smaller than avg (~${AVG_SKILL_TOKENS.toLocaleString()} tokens)`
  if (ratio < 0.7) return `${tokens.toLocaleString()} tokens — below average (avg is ~${AVG_SKILL_TOKENS.toLocaleString()} tokens)`
  if (ratio < 1.3) return `${tokens.toLocaleString()} tokens — about average for a skill (~${AVG_SKILL_TOKENS.toLocaleString()} tokens)`
  if (ratio < 2.0) return `${tokens.toLocaleString()} tokens — above average (avg is ~${AVG_SKILL_TOKENS.toLocaleString()} tokens)`
  return `${tokens.toLocaleString()} tokens — much larger than avg (~${AVG_SKILL_TOKENS.toLocaleString()} tokens)`
}

function generateWhatThisMeans(tokens: number): string {
  const ratio = tokens / AVG_SKILL_TOKENS
  if (ratio < 0.5) return 'Low overhead — the AI loads this context quickly and cheaply. No action needed.'
  if (ratio < 1.2) return 'Bigger skills cost more per invocation and leave less room for conversation. Smaller skills respond faster and cost less.'
  return 'This skill is expensive to load on every turn — every byte competes with your actual conversation for the context window. Trimming it saves real money and improves response speed.'
}

// ── Size bar ─────────────────────────────────────────────────────────────────

function sizeBar(tokens: number): string {
  const maxTokens = 80000
  const barWidth = 30
  const fill = Math.min(Math.round((tokens / maxTokens) * barWidth), barWidth)
  const avgPos = Math.min(Math.round((AVG_SKILL_TOKENS / maxTokens) * barWidth), barWidth - 1)
  const bar = '░'.repeat(fill) + '█' + '░'.repeat(Math.max(barWidth - fill - 1, 0))
  const marker = ' '.repeat(avgPos) + '▲'
  return `[${bar}]\n [${marker} avg]`
}

// ── Main export ──────────────────────────────────────────────────────────────

export function analyzeSkill(dir: string): SkillAnalysisReport {
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
  const grade = calculateGrade(efficiencyScore)

  const summary: SkillAnalysisSummary = {
    total_findings: allFindings.length,
    estimated_tokens_per_invocation: estimatedTokens,
    efficiency_score: efficiencyScore,
  }

  return {
    one_liner: generateOneLiner(grade, estimatedTokens, allFindings.length),
    grade,
    estimated_tokens: estimatedTokens,
    comparison: generateComparison(estimatedTokens),
    cost_per_use: estimateCost(estimatedTokens),
    what_this_means: generateWhatThisMeans(estimatedTokens),
    findings: allFindings,
    summary,
  }
}

// ── Terminal renderer ────────────────────────────────────────────────────────

function gradeColor(grade: SkillGrade): string {
  switch (grade) {
    case 'A': return '\x1b[32m'  // green
    case 'B': return '\x1b[33m'  // yellow
    case 'C': return '\x1b[33m\x1b[1m' // bold yellow
    case 'D': return '\x1b[31m\x1b[1m' // bold red
  }
}

function severityIcon(sev: string): string {
  switch (sev) {
    case 'high': return '\x1b[31m●\x1b[0m'
    case 'medium': return '\x1b[33m●\x1b[0m'
    case 'low': return '\x1b[36m●\x1b[0m'
    default: return '\x1b[2m●\x1b[0m'
  }
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length + word.length + 1 > width && current.length > 0) {
      lines.push(current)
      current = word
    } else {
      current = current.length === 0 ? word : `${current} ${word}`
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

export function renderSkillReport(report: SkillAnalysisReport): string {
  const bold = '\x1b[1m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'
  const cyan = '\x1b[36m'
  const gc = gradeColor(report.grade)

  const lines: string[] = []
  lines.push('')
  lines.push(`${cyan}${bold}  SKILL TOKEN ANALYSIS${reset}`)
  lines.push(`${dim}  ${'─'.repeat(50)}${reset}`)
  lines.push('')
  lines.push(`  ${bold}"${report.one_liner}"${reset}`)
  lines.push('')
  lines.push(`  Grade:  ${gc}${bold}${report.grade}${reset}  (${report.summary.efficiency_score}/100)`)
  lines.push(`  Size:   ${report.comparison}`)
  lines.push('')
  lines.push(`  ${sizeBar(report.estimated_tokens)}`)
  lines.push('')
  lines.push(`  Context load:  ${report.cost_per_use.sonnet_context_load} (Sonnet)  |  ${report.cost_per_use.opus_context_load} (Opus)`)
  lines.push(`  ${dim}${report.cost_per_use.pricing_note}${reset}`)
  lines.push('')

  if (report.findings.length > 0) {
    lines.push(`  ${bold}Findings (${report.findings.length}):${reset}`)
    for (const f of report.findings) {
      const icon = severityIcon(f.severity)
      lines.push(`  ${icon} ${bold}${f.rule}${reset} [${f.severity}]`)
      // Wrap description to 76 chars (terminal width minus indentation)
      for (const ln of wrapText(f.description, 76)) {
        lines.push(`    ${dim}${ln}${reset}`)
      }
      if (f.remediation) {
        for (const remediationLine of f.remediation.split('\n')) {
          for (const ln of wrapText(`Fix: ${remediationLine}`, 76)) {
            lines.push(`    ${dim}${ln}${reset}`)
          }
        }
      }
      lines.push('')
    }
  } else {
    lines.push(`  ${dim}No findings. Structure looks clean.${reset}`)
    lines.push('')
  }

  lines.push(`  ${dim}${report.what_this_means}${reset}`)
  lines.push('')

  return lines.join('\n')
}
