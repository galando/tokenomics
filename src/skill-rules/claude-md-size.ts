/**
 * CLAUDE.md Size Rule
 *
 * Detects CLAUDE.md injection blocks and flags oversized ones.
 * Looks for <!-- TOKENOMICS:START --> markers or large markdown blocks
 * in CLAUDE.md files.
 *
 * Thresholds:
 *   >1500 tokens (6000 chars) → medium
 *   >3000 tokens (12000 chars) → high
 */

import type { SkillAnalysisContext, SkillFinding } from '../types.js'

const CHARS_PER_TOKEN = 4
const MEDIUM_TOKEN_THRESHOLD = 1500
const HIGH_TOKEN_THRESHOLD = 3000

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []

  for (const [filename, content] of context.files) {
    if (!filename.toLowerCase().includes('claude.md')) continue

    // Check for TOKENOMICS injection blocks
    const tokenomicsBlocks = extractTokenomicsBlocks(content)
    if (tokenomicsBlocks.length > 0) {
      for (const block of tokenomicsBlocks) {
        const tokenEstimate = Math.ceil(block.length / CHARS_PER_TOKEN)
        flagBlock(findings, filename, tokenEstimate, 'tokenomics injection block')
      }
      continue
    }

    // No injection markers — evaluate the whole file if it looks like an injection target
    const tokenEstimate = Math.ceil(content.length / CHARS_PER_TOKEN)
    flagBlock(findings, filename, tokenEstimate, 'CLAUDE.md content')
  }

  return findings
}

function extractTokenomicsBlocks(content: string): string[] {
  const blocks: string[] = []
  const startMarker = '<!-- TOKENOMICS:START'
  const endMarker = '<!-- TOKENOMICS:END'

  let searchFrom = 0
  while (searchFrom < content.length) {
    const startIdx = content.indexOf(startMarker, searchFrom)
    if (startIdx === -1) break

    const endIdx = content.indexOf(endMarker, startIdx)
    if (endIdx === -1) break

    // Include from start marker to end of end marker line
    const endOfBlock = content.indexOf('\n', endIdx)
    const blockEnd = endOfBlock === -1 ? content.length : endOfBlock
    blocks.push(content.slice(startIdx, blockEnd))
    searchFrom = blockEnd
  }

  return blocks
}

function flagBlock(
  findings: SkillFinding[],
  filename: string,
  tokenEstimate: number,
  blockDescription: string,
): void {
  if (tokenEstimate > HIGH_TOKEN_THRESHOLD) {
    findings.push({
      rule: 'claude-md-size',
      severity: 'high',
      confidence: 0.9,
      description: `${blockDescription} in "${filename}" is ~${tokenEstimate.toLocaleString()} tokens. This injects into every session's system prompt.`,
      location: filename,
      remediation: `Reduce the ${blockDescription} in "${filename}" to under ${HIGH_TOKEN_THRESHOLD} tokens. Use dynamic placeholders or move static content to files that are read on demand.`,
    })
  } else if (tokenEstimate > MEDIUM_TOKEN_THRESHOLD) {
    findings.push({
      rule: 'claude-md-size',
      severity: 'medium',
      confidence: 0.85,
      description: `${blockDescription} in "${filename}" is ~${tokenEstimate.toLocaleString()} tokens. Every session pays this context cost.`,
      location: filename,
      remediation: `Trim the ${blockDescription} in "${filename}" to under ${MEDIUM_TOKEN_THRESHOLD} tokens. Remove redundant instructions or consolidate overlapping guidance.`,
    })
  }
}
