/**
 * Section Analysis Rule
 *
 * Parses markdown files into sections (by headings) and:
 * 1. Reports per-section token counts (always for files >1000 tokens)
 * 2. Detects sections with redundant/overlapping content (within file AND cross-file)
 * 3. Suggests which sections can be shortened and why
 *
 * Analyzes SKILL.md, .atom.md, and reference files under references/.
 */

import type { SkillAnalysisContext, SkillFinding, SkillSection } from '../types.js'

const CHARS_PER_TOKEN = 4
const SECTION_TOKEN_THRESHOLD = 500
const LARGE_SECTION_THRESHOLD = 1000
const FILE_TOKEN_BREAKDOWN_THRESHOLD = 1000 // Always report breakdown for files above this

const PROMPT_FILE_PATTERNS = [
  /^SKILL\.md$/i,
  /\.atom\.md$/i,
]

const ALL_MD_PATTERN = /\.md$/i

function isPromptFile(filename: string): boolean {
  return PROMPT_FILE_PATTERNS.some(p => p.test(filename))
}

function isMarkdownFile(filename: string): boolean {
  return ALL_MD_PATTERN.test(filename)
}

interface ParsedSection {
  heading: string
  level: number
  lineStart: number
  content: string
  tokens: number
}

interface FileSections {
  filename: string
  sections: ParsedSection[]
  totalTokens: number
}

function parseSections(content: string): ParsedSection[] {
  const lines = content.split('\n')
  const sections: ParsedSection[] = []
  let currentHeading = '(preamble)'
  let currentLevel = 0
  let currentLineStart = 0
  let currentLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    // Match markdown headings: # through ######, also handle frontmatter (---)
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
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function jaccardSimilarity(textA: string, textB: string): number {
  const normA = normalizeContent(textA)
  const normB = normalizeContent(textB)
  if (normA.length < 20 || normB.length < 20) return 0

  const wordsA = new Set(normA.split(' ').filter(w => w.length > 3))
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 3))
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  const intersection = [...wordsA].filter(w => wordsB.has(w))
  const union = new Set([...wordsA, ...wordsB])
  return intersection.length / union.size
}

interface RedundancyLink {
  sourceFile: string
  sourceSection: string
  targetFile: string
  targetSection: string
  similarity: number
}

interface RedundancyPeer {
  file: string
  section: string
}

function detectRedundancy(allFileSections: FileSections[]): RedundancyLink[] {
  const links: RedundancyLink[] = []
  const allSections: Array<{ file: string; section: ParsedSection }> = []

  for (const fs of allFileSections) {
    for (const s of fs.sections) {
      allSections.push({ file: fs.filename, section: s })
    }
  }

  for (let i = 0; i < allSections.length; i++) {
    const a = allSections[i]!
    if (a.section.tokens < 20) continue // Skip tiny sections

    for (let j = i + 1; j < allSections.length; j++) {
      const b = allSections[j]!
      if (b.section.tokens < 20) continue

      const similarity = jaccardSimilarity(a.section.content, b.section.content)
      if (similarity > 0.25) {
        links.push({
          sourceFile: a.file,
          sourceSection: a.section.heading,
          targetFile: b.file,
          targetSection: b.section.heading,
          similarity,
        })
      }
    }
  }

  return links.sort((a, b) => b.similarity - a.similarity)
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
    tips.push(`Has ${Math.floor(codeBlockCount)} code blocks — consider replacing examples with file references`)
  }

  // Check for list items that could be collapsed
  const listItems = lines.filter(l => /^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l))
  if (listItems.length > 8) {
    tips.push(`${listItems.length} list items — consider grouping into categories or moving details to separate files`)
  }

  // Check for table-heavy content
  const tableRows = lines.filter(l => /^\|/.test(l.trim()))
  if (tableRows.length > 15) {
    tips.push(`${tableRows.length} table rows — consider moving detailed tables to reference files and keeping only a summary`)
  }

  // ── Content-level suggestions ──────────────────────────────────────────

  const normalizedContent = normalizeContent(section.content)

  // Detect concept repetition: same key phrase appearing many times
  const PHRASE_MIN_LENGTH = 4
  const words = normalizedContent.split(' ').filter(w => w.length > 2)
  const phraseCounts = new Map<string, number>()
  for (let i = 0; i < words.length - PHRASE_MIN_LENGTH; i++) {
    const phrase = words.slice(i, i + PHRASE_MIN_LENGTH).join(' ')
    phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
  }
  const repeatedPhrases = [...phraseCounts.entries()].filter(([, c]) => c >= 3)
  if (repeatedPhrases.length > 0) {
    const topPhrase = repeatedPhrases.sort((a, b) => b[1]! - a[1]!)[0]!
    tips.push(`Concept "${topPhrase[0]!.slice(0, 50)}..." is restated ${topPhrase[1]!} times — state the rule once, reference it elsewhere`)
  }

  // Detect restatement patterns: "X is Y" followed later by "X means Y" or "remember: X is Y"
  const restatementPatterns = [
    /remember.{0,10}(that|:)\s/gi,
    /note.{0,5}(that|:)\s/gi,
    /this (is|means)\s/gi,
    /in other words/gi,
    /that (is to say|means)\s/gi,
    /this is (non-)?negotiable/gi,
  ]
  let restatementCount = 0
  for (const pattern of restatementPatterns) {
    const matches = section.content.match(pattern)
    if (matches) restatementCount += matches.length
  }
  if (restatementCount >= 2) {
    tips.push(`${restatementCount} restatement(s) detected ("remember that", "note that", "in other words") — the AI already understood the first time; remove re-explanations`)
  }

  // Detect anti-pattern examples that double the content
  // Pattern: shows bad example then immediately shows the fix
  const badGoodPairs = section.content.match(/\bad\b|\bwrong\b|\bdon't\b|\bavoid\b|\bnever\b/gi) ?? []
  const goodExamples = section.content.match(/\bgood\b|\bcorrect\b|\bfixed\b|\bfixed\b|\binstead\b|\brather\b/gi) ?? []
  if (badGoodPairs.length >= 3 && goodExamples.length >= 3) {
    tips.push(`Shows ${badGoodPairs.length} bad examples alongside good ones — consider showing only the correct pattern and stating the rule as a negative constraint (e.g. "never do X")`)
  }

  // Detect overly specific enumeration that could be a rule
  // e.g. listing 8 specific file paths when a glob pattern or rule would suffice
  const specificPaths = section.content.match(/[\w/-]+\.\w{2,4}/g) ?? []
  const uniquePaths = new Set(specificPaths.map(p => p.toLowerCase()))
  if (uniquePaths.size > 6) {
    tips.push(`References ${uniquePaths.size} specific file paths — consider replacing some with a glob pattern or naming convention rule`)
  }

  // Detect verbose justification that the AI doesn't need
  // "This is important because..." / "The reason for this is..." / "Why? Because..."
  const justificationPatterns = section.content.match(/(this is important|the reason for|why\? because|this matters because|this is critical because)/gi) ?? []
  if (justificationPatterns.length >= 2) {
    tips.push(`${justificationPatterns.length} justification(s) ("this is important because", "the reason for") — the AI follows instructions without needing persuasion; state the rule directly`)
  }

  // Detect duplicate directory trees / ASCII diagrams
  const treeLineCount = lines.filter(l => /^[├└│─┤┬┴┼┌┐└┘││  ]+[a-z]/.test(l) || /^\s+[a-z_]+\/\s*$/i.test(l)).length
  if (treeLineCount > 10) {
    tips.push(`Directory tree is ${treeLineCount} lines — consider keeping only the top-level structure and linking to a reference file for the full tree`)
  }

  return tips.length > 0 ? tips.join('. ') + '.' : undefined
}

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []

  // Parse all markdown files into sections
  const promptFileSections: FileSections[] = []
  const referenceFileSections: FileSections[] = []

  for (const [filename, content] of context.files) {
    if (!isMarkdownFile(filename)) continue
    if (content.trim().length === 0) continue

    const sections = parseSections(content)
    if (sections.length === 0) continue

    const totalTokens = Math.ceil(content.length / CHARS_PER_TOKEN)
    const entry: FileSections = { filename, sections, totalTokens }

    if (isPromptFile(filename)) {
      promptFileSections.push(entry)
    } else if (filename.includes('references/')) {
      referenceFileSections.push(entry)
    }
  }

  // Cross-file + within-file redundancy detection across all files
  const allFileSections = [...promptFileSections, ...referenceFileSections]
  const redundancyLinks = detectRedundancy(allFileSections)

  // Build redundancy lookup: filename → section heading → redundant peers
  const redundancyLookup = new Map<string, Map<string, RedundancyPeer[]>>()
  for (const link of redundancyLinks) {
    // Forward direction
    let fileMap = redundancyLookup.get(link.sourceFile)
    if (!fileMap) { fileMap = new Map(); redundancyLookup.set(link.sourceFile, fileMap) }
    let peers = fileMap.get(link.sourceSection)
    if (!peers) { peers = []; fileMap.set(link.sourceSection, peers) }
    peers.push({ file: link.targetFile, section: link.targetSection })

    // Reverse direction
    fileMap = redundancyLookup.get(link.targetFile)
    if (!fileMap) { fileMap = new Map(); redundancyLookup.set(link.targetFile, fileMap) }
    peers = fileMap.get(link.targetSection)
    if (!peers) { peers = []; fileMap.set(link.targetSection, peers) }
    peers.push({ file: link.sourceFile, section: link.sourceSection })
  }

  // Generate findings per prompt file
  for (const { filename, sections, totalTokens } of promptFileSections) {
    const fileRedundancy = redundancyLookup.get(filename) ?? new Map()

    // Build per-section data
    const sectionData: SkillSection[] = sections.map((s) => {
      const peers: RedundancyPeer[] | undefined = fileRedundancy.get(s.heading)
      // Deduplicate peer labels
      const peerLabels: string[] | undefined = peers
        ? [...new Set(peers.map((p: RedundancyPeer) => p.file === filename ? `"${p.section}"` : `${p.file} → "${p.section}"`))]
        : undefined

      return {
        heading: s.heading,
        level: s.level,
        lineStart: s.lineStart,
        tokens: s.tokens,
        redundantWith: peerLabels && peerLabels.length > 0 ? peerLabels : undefined,
        shorteningTip: getShorteningTip(s),
      }
    })

    // Determine what's actionable
    const largeSections = sections.filter(s => s.tokens > SECTION_TOKEN_THRESHOLD)
    const redundantSections = sections.filter(s => (fileRedundancy.get(s.heading) ?? []).length > 0)
    const shortenableSections = sections.filter((_, idx) => sectionData[idx]!.shorteningTip !== undefined)
    const hasLargeFile = totalTokens > FILE_TOKEN_BREAKDOWN_THRESHOLD

    // Generate finding if anything actionable OR file is large enough to warrant breakdown
    if (!hasLargeFile && largeSections.length === 0 && redundantSections.length === 0 && shortenableSections.length === 0) continue

    // Build description
    const parts: string[] = []
    if (largeSections.length > 0) {
      const top = largeSections.sort((a, b) => b.tokens - a.tokens)[0]!
      parts.push(`Largest section "${top.heading}" is ~${top.tokens.toLocaleString()} tokens`)
    }
    if (redundantSections.length > 0) {
      const crossFile = redundantSections.filter(s => {
        const peers: RedundancyPeer[] = fileRedundancy.get(s.heading) ?? []
        return peers.some((p: RedundancyPeer) => p.file !== filename)
      })
      if (crossFile.length > 0) {
        parts.push(`${crossFile.length} section(s) duplicate content from reference files`)
      }
      const withinFile = redundantSections.filter(s => {
        const peers: RedundancyPeer[] = fileRedundancy.get(s.heading) ?? []
        return peers.some((p: RedundancyPeer) => p.file === filename)
      })
      if (withinFile.length > 0) {
        const names = withinFile.map(s => `"${s.heading}"`)
        parts.push(`${withinFile.length} section(s) overlap each other: ${names.join(', ')}`)
      }
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
      const peers: RedundancyPeer[] = fileRedundancy.get(s.heading) ?? []
      const crossFilePeers = peers.filter((p: RedundancyPeer) => p.file !== filename)
      const sameFilePeers = peers.filter((p: RedundancyPeer) => p.file === filename)

      if (crossFilePeers.length > 0) {
        const targets = [...new Set(crossFilePeers.map((p: RedundancyPeer) => `${p.file} "${p.section}"`))].join(', ')
        remediationParts.push(`"${s.heading}" duplicates content from ${targets}: keep it in one place, reference from the other`)
      }
      if (sameFilePeers.length > 0) {
        const targets = [...new Set(sameFilePeers.map((p: RedundancyPeer) => `"${p.section}"`))].join(', ')
        remediationParts.push(`"${s.heading}" overlaps with ${targets}: consolidate shared content into one section`)
      }
    }
    for (const s of shortenableSections.slice(0, 3)) {
      const idx = sections.indexOf(s)
      const tip = sectionData[idx]!.shorteningTip
      remediationParts.push(`"${s.heading}": ${tip}`)
    }

    // Section token breakdown for context
    const topSections = [...sections].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
    const breakdown = topSections.map(s => `"${s.heading}": ${s.tokens}`).join(', ')

    findings.push({
      rule: 'section-analysis',
      severity,
      confidence: 0.8,
      description: parts.length > 0
        ? `${filename}: ${parts.join('. ')}. Total: ~${totalTokens.toLocaleString()} tokens across ${sections.length} sections (top: ${breakdown})`
        : `${filename}: ~${totalTokens.toLocaleString()} tokens across ${sections.length} sections. Token breakdown: ${breakdown}`,
      location: filename,
      remediation: remediationParts.length > 0 ? remediationParts.join('\n') : 'No shortening opportunities detected — structure looks efficient.',
      sections: sectionData,
    })
  }

  return findings
}
