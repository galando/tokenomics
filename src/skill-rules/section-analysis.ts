/**
 * Section Analysis Rule
 *
 * Parses markdown files into sections (by headings) and:
 * 1. Reports per-section token counts
 * 2. Detects sections with redundant/overlapping content
 * 3. Suggests which sections can be shortened and why
 *
 * Only analyzes SKILL.md and .atom.md files.
 */

import type { SkillAnalysisContext, SkillFinding, SkillSection } from '../types.js'

const CHARS_PER_TOKEN = 4

const SECTION_TOKEN_THRESHOLD = 500 // Flag sections >500 tokens
const LARGE_SECTION_THRESHOLD = 1000 // Flag sections >1000 tokens

const PROMPT_FILE_PATTERNS = [
  /^SKILL\.md$/i,
  /\.atom\.md$/i,
]

function isPromptFile(filename: string): boolean {
  return PROMPT_FILE_PATTERNS.some(p => p.test(filename))
}

interface ParsedSection {
  heading: string
  level: number
  lineStart: number
  content: string
  tokens: number
}

function parseSections(content: string): ParsedSection[] {
  const lines = content.split('\n')
  const sections: ParsedSection[] = []
  let currentHeading = '(preamble)'
  let currentLevel = 0
  let currentLineStart = 0
  let currentLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i]!.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      // Flush previous section
      if (currentLines.length > 0 || currentHeading !== '(preamble)') {
        const sectionContent = currentLines.join('\n')
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          lineStart: currentLineStart,
          content: sectionContent,
          tokens: Math.ceil(sectionContent.length / CHARS_PER_TOKEN),
        })
      }
      currentHeading = headingMatch[2]!.trim()
      currentLevel = headingMatch[1]!.length
      currentLineStart = i
      currentLines = []
    } else {
      currentLines.push(lines[i]!)
    }
  }

  // Flush last section
  const lastContent = currentLines.join('\n')
  if (lastContent.trim().length > 0 || currentHeading !== '(preamble)') {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      lineStart: currentLineStart,
      content: lastContent,
      tokens: Math.ceil(lastContent.length / CHARS_PER_TOKEN),
    })
  }

  return sections
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '')        // Remove inline code
    .replace(/[^\w\s]/g, '')        // Remove punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

function detectRedundantSections(sections: ParsedSection[]): Map<number, string[]> {
  const redundancyMap = new Map<number, string[]>()

  for (let i = 0; i < sections.length; i++) {
    const normA = normalizeContent(sections[i]!.content)
    if (normA.length < 40) continue // Skip tiny sections

    for (let j = i + 1; j < sections.length; j++) {
      const normB = normalizeContent(sections[j]!.content)
      if (normB.length < 40) continue

      // Jaccard similarity on word sets
      const wordsA = new Set(normA.split(' ').filter(w => w.length > 3))
      const wordsB = new Set(normB.split(' ').filter(w => w.length > 3))

      if (wordsA.size === 0 || wordsB.size === 0) continue

      const intersection = [...wordsA].filter(w => wordsB.has(w))
      const union = new Set([...wordsA, ...wordsB])
      const similarity = intersection.length / union.size

      if (similarity > 0.4) {
        const existing = redundancyMap.get(i) ?? []
        existing.push(sections[j]!.heading)
        redundancyMap.set(i, existing)

        const existingJ = redundancyMap.get(j) ?? []
        existingJ.push(sections[i]!.heading)
        redundancyMap.set(j, existingJ)
      }
    }
  }

  return redundancyMap
}

function getShorteningTip(section: ParsedSection): string | undefined {
  const lines = section.content.split('\n').filter(l => l.trim().length > 0)
  const tips: string[] = []

  // Check for repeated lines
  const lineCounts = new Map<string, number>()
  for (const line of lines) {
    const norm = line.toLowerCase().trim()
    if (norm.length < 20) continue
    lineCounts.set(norm, (lineCounts.get(norm) ?? 0) + 1)
  }
  const repeatedLines = [...lineCounts.entries()].filter(([, c]) => c > 1)
  if (repeatedLines.length > 0) {
    const example = repeatedLines[0]![0]!.slice(0, 60)
    tips.push(`Contains ${repeatedLines.length} repeated line(s), e.g. "${example}..."`)
  }

  // Check for code blocks
  const codeBlockCount = (section.content.match(/```/g) ?? []).length / 2
  if (codeBlockCount >= 2) {
    tips.push(`Has ${codeBlockCount} code blocks — consider replacing examples with file references`)
  }

  // Check for list items that could be collapsed
  const listItems = lines.filter(l => /^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l))
  if (listItems.length > 8) {
    tips.push(`${listItems.length} list items — consider grouping into categories or moving details to separate files`)
  }

  // Check for very long paragraphs
  const paragraphs = section.content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const longParagraphs = paragraphs.filter(p => p.length > 1500)
  if (longParagraphs.length > 0) {
    tips.push(`${longParagraphs.length} long paragraph(s) over 375 tokens — consider breaking into bullet points`)
  }

  return tips.length > 0 ? tips.join('. ') + '.' : undefined
}

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []

  for (const [filename, content] of context.files) {
    if (!isPromptFile(filename)) continue
    if (content.trim().length === 0) continue

    const sections = parseSections(content)
    if (sections.length === 0) continue

    const redundancyMap = detectRedundantSections(sections)

    // Build per-section data with tips
    const sectionData: SkillSection[] = sections.map((s, idx) => ({
      heading: s.heading,
      level: s.level,
      lineStart: s.lineStart,
      tokens: s.tokens,
      redundantWith: redundancyMap.get(idx),
      shorteningTip: getShorteningTip(s),
    }))

    // Find oversized sections
    const largeSections = sections.filter(s => s.tokens > SECTION_TOKEN_THRESHOLD)

    // Find sections with redundancy
    const redundantSections = [...redundancyMap.entries()]
      .filter(([, peers]) => peers.length > 0)
      .map(([idx]) => sections[idx]!)

    // Find sections with shortening opportunities
    const shortenableSections = sections.filter((_, idx) => {
      const tip = sectionData[idx]!.shorteningTip
      return tip !== undefined
    })

    // Generate finding if anything actionable
    const hasIssues = largeSections.length > 0 || redundantSections.length > 0 || shortenableSections.length > 0

    if (!hasIssues) continue

    // Build description
    const parts: string[] = []
    if (largeSections.length > 0) {
      const top = largeSections.sort((a, b) => b.tokens - a.tokens)[0]!
      parts.push(`Largest section "${top.heading}" is ~${top.tokens.toLocaleString()} tokens`)
    }
    if (redundantSections.length > 0) {
      const names = redundantSections.map(s => `"${s.heading}"`)
      parts.push(`${redundantSections.length} section(s) overlap: ${names.join(', ')}`)
    }
    if (shortenableSections.length > 0) {
      parts.push(`${shortenableSections.length} section(s) have shortening opportunities`)
    }

    // Determine severity
    const maxTokens = Math.max(...sections.map(s => s.tokens))
    const severity = maxTokens > LARGE_SECTION_THRESHOLD
      ? 'high'
      : largeSections.length > 0
        ? 'medium'
        : redundantSections.length > 0
          ? 'low'
          : 'info'

    // Build remediation
    const remediationParts: string[] = []
    for (const s of largeSections.sort((a, b) => b.tokens - a.tokens).slice(0, 3)) {
      remediationParts.push(`"${s.heading}" (${s.tokens} tokens): split into smaller focused subsections or move details to separate files`)
    }
    for (const s of redundantSections.slice(0, 3)) {
      const peers = redundancyMap.get(sections.indexOf(s)) ?? []
      remediationParts.push(`"${s.heading}" overlaps with ${peers.join(', ')}: consolidate shared content into one section`)
    }
    for (let i = 0; i < shortenableSections.length; i++) {
      const idx = sections.indexOf(shortenableSections[i]!)
      const tip = sectionData[idx]!.shorteningTip
      remediationParts.push(`"${shortenableSections[i]!.heading}": ${tip}`)
    }

    findings.push({
      rule: 'section-analysis',
      severity,
      confidence: 0.8,
      description: `${filename}: ${parts.join('. ')}. Total file: ~${Math.ceil(content.length / CHARS_PER_TOKEN).toLocaleString()} tokens across ${sections.length} sections.`,
      location: filename,
      remediation: remediationParts.join('\n'),
      sections: sectionData,
    })
  }

  return findings
}
