/**
 * Tool Overhead Rule
 *
 * Counts tool definitions in skill config files (tank.json, skills.json).
 * Each tool adds ~200-500 tokens of context overhead per invocation.
 *
 * Thresholds:
 *   >8 tools → medium (1600-4000 extra tokens per invocation)
 *   >15 tools → high (3000-7500 extra tokens per invocation)
 */

import type { SkillAnalysisContext, SkillFinding } from '../types.js'

const MEDIUM_TOOL_THRESHOLD = 8
const HIGH_TOOL_THRESHOLD = 15

const TOOL_SECTIONS = ['tools', 'mcpServers', 'mcp_servers', 'serverTools', 'server_tools']
const MANIFEST_FILES = ['tank.json', 'skills.json']

interface ToolEntry {
  name: string
  source: string
}

function countTools(manifest: Record<string, unknown> | null, files: Map<string, string>): ToolEntry[] {
  const tools: ToolEntry[] = []

  // Extract from manifest
  if (manifest) {
    // Check common manifest structures
    const toolSections = TOOL_SECTIONS
    for (const section of toolSections) {
      const sectionData = manifest[section]
      if (typeof sectionData === 'object' && sectionData !== null) {
        if (Array.isArray(sectionData)) {
          for (const entry of sectionData) {
            if (typeof entry === 'object' && entry !== null && 'name' in entry) {
              tools.push({ name: String((entry as Record<string, unknown>)['name']), source: 'manifest' })
            }
          }
        } else {
          // Object with keys = tool names
          for (const key of Object.keys(sectionData as Record<string, unknown>)) {
            tools.push({ name: key, source: 'manifest' })
          }
        }
      }
    }
  }

  // Also scan config files for tool definitions
  for (const [filename, content] of files) {
    if (!MANIFEST_FILES.includes(filename) && !filename.endsWith('.json')) continue

    try {
      const parsed = JSON.parse(content)
      for (const section of TOOL_SECTIONS) {
        const sectionData = parsed[section]
        if (typeof sectionData === 'object' && sectionData !== null && !Array.isArray(sectionData)) {
          for (const key of Object.keys(sectionData)) {
            if (!tools.some(t => t.name === key)) {
              tools.push({ name: key, source: filename })
            }
          }
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return tools
}

export function analyze(context: SkillAnalysisContext): SkillFinding[] {
  const findings: SkillFinding[] = []
  const tools = countTools(context.skillManifest, context.files)
  const toolCount = tools.length

  if (toolCount > HIGH_TOOL_THRESHOLD) {
    findings.push({
      rule: 'tool-overhead',
      severity: 'high',
      confidence: 0.9,
      description: `${toolCount} tool definitions found. Each tool adds ~200-500 tokens of context overhead per invocation (~${toolCount * 200}-${toolCount * 500} extra tokens total).`,
      location: 'manifest/config',
      remediation: `Reduce to ${HIGH_TOOL_THRESHOLD} or fewer tools. Remove unused tools, or use lazy-loading patterns where tools are only registered when the skill enters a specific workflow.`,
    })
  } else if (toolCount > MEDIUM_TOOL_THRESHOLD) {
    findings.push({
      rule: 'tool-overhead',
      severity: 'medium',
      confidence: 0.85,
      description: `${toolCount} tool definitions found. Each tool adds ~200-500 tokens of context overhead per invocation (~${toolCount * 200}-${toolCount * 500} extra tokens total).`,
      location: 'manifest/config',
      remediation: `Consider reducing to ${MEDIUM_TOOL_THRESHOLD} or fewer tools. Consolidate related tools or implement on-demand registration.`,
    })
  }

  return findings
}
