/**
 * Redundant Instructions Rule
 *
 * Detects repeated instruction patterns across skill files (SKILL.md, .atom.md, CLAUDE.md).
 * Flags when >30% of instruction lines are duplicates across files.
 *
 * Uses line-level deduplication with normalization:
 * - Lowercased, trimmed, collapsed whitespace
 * - Ignores blank lines and very short lines (<20 chars)
 */

import type { SkillAnalysisContext, SkillFinding } from '../types.js'

const DUPLICATION_THRESHOLD = 0.3
const MIN_LINE_LENGTH = 20

const SKILL_FILE_PATTERNS = [
  /SKILL\.md$/i,
  /\.atom\.md$/i,
  /CLAUDE\.md$/i,
]

function isSkillFile(filename: string): boolean {
  return SKILL_FILE_PATTERNS.some(p => p.test(filename))
}

function normalizeLine(line: string): string {
  return line.toLowerCase().trim().replace(/\s+/g, ' ')
}

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []

  // Collect normalized lines per skill file
  const fileLines = new Map<string, string[]>()
  for (const [filename, content] of context.files) {
    if (!isSkillFile(filename)) continue
    const lines = content
      .split('\n')
      .map(normalizeLine)
      .filter(l => l.length >= MIN_LINE_LENGTH)
    fileLines.set(filename, lines)
  }

  if (fileLines.size < 2) return findings

  // Count total unique lines and total lines
  const allLines: string[] = []
  // Track how many times each line appears across all files (with file source)
  const lineFileCount = new Map<string, { count: number; files: string[] }>()

  for (const [filename, lines] of fileLines) {
    for (const line of lines) {
      allLines.push(line)
      const entry = lineFileCount.get(line) ?? { count: 0, files: [] }
      entry.count++
      if (!entry.files.includes(filename)) {
        entry.files.push(filename)
      }
      lineFileCount.set(line, entry)
    }
  }

  const totalLines = allLines.length
  if (totalLines === 0) return findings

  // Count duplicated lines: lines that appear in 2+ different files
  const duplicatedLines = [...lineFileCount.entries()]
    .filter(([, entry]) => entry.files.length >= 2)

  // Count actual duplicated occurrences (total occurrences minus one per unique line)
  const duplicatedCount = duplicatedLines.reduce((sum, [, entry]) => {
    // All occurrences beyond the first file's count are redundant
    return sum + entry.count - Math.ceil(entry.count / entry.files.length)
  }, 0)

  const duplicationRate = duplicatedCount / totalLines

  if (duplicationRate > DUPLICATION_THRESHOLD) {
    const exampleDuplicates = duplicatedLines
      .slice(0, 3)
      .map(([line, entry]) => `"${line.slice(0, 60)}${line.length > 60 ? '...' : ''}" in ${entry.files.join(', ')}`)
      .join('\n    ')

    findings.push({
      rule: 'redundant-instructions',
      severity: duplicationRate > 0.5 ? 'medium' : 'low',
      confidence: 0.75,
      description: `${Math.round(duplicationRate * 100)}% of instruction lines are duplicated across skill files. ${duplicatedCount} of ${totalLines} lines are redundant, wasting tokens on every invocation.`,
      location: [...fileLines.keys()].join(', '),
      remediation: `Consolidate shared instructions into a single file and reference it from others. Remove duplicated lines from individual files. Examples:\n    ${exampleDuplicates}`,
    })
  }

  return findings
}
