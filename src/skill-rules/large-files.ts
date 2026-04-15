/**
 * Large Files Rule
 *
 * Flags files >500 lines that would be expensive to read during skill execution.
 * Large files in a skill package indicate potential token waste when the AI reads them.
 */

import type { SkillAnalysisContext, SkillFinding } from '../types.js'

const CHARS_PER_TOKEN = 4
const LINE_THRESHOLD = 500

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []

  for (const [filename, content] of context.files) {
    const lineCount = content.split('\n').length

    if (lineCount > LINE_THRESHOLD) {
      findings.push({
        rule: 'large-files',
        severity: lineCount > 1000 ? 'medium' : 'low',
        confidence: 0.8,
        description: `"${filename}" is ${lineCount.toLocaleString()} lines. Reading this file costs ~${Math.ceil(content.length / CHARS_PER_TOKEN).toLocaleString()} tokens per invocation.`,
        location: filename,
        remediation: `Split "${filename}" into smaller, focused files. Use lazy-loading: keep an index/summary file and load detailed sections only when needed.`,
      })
    }
  }

  return findings
}
