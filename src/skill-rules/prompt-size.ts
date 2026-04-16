/**
 * Prompt Size Rule
 *
 * Flags SKILL.md and .atom.md files that exceed token thresholds.
 * Token estimation: 1 token ≈ 4 characters.
 *
 * Thresholds:
 *   >2000 tokens (8000 chars) → medium
 *   >4000 tokens (16000 chars) → high
 */

import type { SkillAnalysisContext, SkillFinding } from '../types.js'

const CHARS_PER_TOKEN = 4
const MEDIUM_TOKEN_THRESHOLD = 2000
const HIGH_TOKEN_THRESHOLD = 4000

const PROMPT_FILE_PATTERNS = [
  /^SKILL\.md$/i,
  /\.atom\.md$/i,
]

function isPromptFile(filename: string): boolean {
  return PROMPT_FILE_PATTERNS.some(p => p.test(filename))
}

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []

  for (const [filename, content] of context.files) {
    if (!isPromptFile(filename)) continue

    const tokenEstimate = Math.ceil(content.length / CHARS_PER_TOKEN)

    if (tokenEstimate > HIGH_TOKEN_THRESHOLD) {
      findings.push({
        rule: 'prompt-size',
        severity: 'high',
        confidence: 0.95,
        description: `Prompt file "${filename}" is ~${tokenEstimate.toLocaleString()} tokens (${content.length.toLocaleString()} chars). This loads into context on every skill invocation.`,
        location: filename,
        remediation: `Trim "${filename}" to under ${HIGH_TOKEN_THRESHOLD} tokens. Move detailed examples, edge cases, or reference material to separate files that are read on demand. Keep the core instructions concise.`,
      })
    } else if (tokenEstimate > MEDIUM_TOKEN_THRESHOLD) {
      findings.push({
        rule: 'prompt-size',
        severity: 'medium',
        confidence: 0.9,
        description: `Prompt file "${filename}" is ~${tokenEstimate.toLocaleString()} tokens (${content.length.toLocaleString()} chars). Consider trimming for faster invocations.`,
        location: filename,
        remediation: `Consider trimming "${filename}" to under ${MEDIUM_TOKEN_THRESHOLD} tokens. Extract verbose examples or lengthy explanations into separate reference files.`,
      })
    }
  }

  return findings
}
