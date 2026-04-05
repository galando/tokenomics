/**
 * CLAUDE.md Overhead Detector
 *
 * Detects oversized or inefficient CLAUDE.md files:
 * - Large files adding overhead to every message
 * - Duplicate config (content also in .eslintrc, tsconfig.json, etc.)
 * - Content better suited for on-demand instruction files
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionData, DetectorResult, Remediation, AgentContext } from '../types.js';
import { adjustConfidenceForEstimates } from './agent-context.js';

interface ClaudeMdEvidence {
  project: string;
  path: string;
  tokenCount: number;
  sizeBytes: number;
  issues: string[];
  estimatedOverhead: number;
  sessionsAffected: number;
}

const CONFIG_KEYWORDS = [
  'eslint', 'prettier', 'typescript', 'tsconfig',
  'webpack', 'vite', 'babel', 'jest', 'vitest',
];

const SKILL_CANDIDATE_PATTERNS = [
  /step-by-step/i,
  /checklist/i,
  /always\s+(do|use|follow)/i,
  /never\s+(do|use)/i,
  /before\s+committing/i,
  /when\s+implementing/i,
];

function estimateTokens(content: string): number {
  // Rough estimate: ~3.5 chars per token for English/code
  return Math.round(content.length / 3.5);
}

function detectConfigDuplication(content: string): string[] {
  const issues: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const keyword of CONFIG_KEYWORDS) {
    if (lowerContent.includes(keyword)) {
      // Check if it looks like actual config (not just a mention)
      if (
        lowerContent.includes(`${keyword}config`) ||
        lowerContent.includes(`${keyword}.json`) ||
        lowerContent.includes(`${keyword}.js`) ||
        lowerContent.includes(`"${keyword}"`)
      ) {
        issues.push(`Contains ${keyword} configuration that should be in config file`);
      }
    }
  }

  return issues;
}

function detectSkillCandidates(content: string): string[] {
  const issues: string[] = [];

  for (const pattern of SKILL_CANDIDATE_PATTERNS) {
    if (pattern.test(content)) {
      issues.push('Contains procedural content better suited for an on-demand instruction file');
      break;
    }
  }

  return issues;
}

export async function detectClaudeMdOverhead(
  sessions: SessionData[],
  _agentContext?: AgentContext
): Promise<DetectorResult | null> {
  if (sessions.length === 0) return null;

  // This detector only supports Claude Code
  const claudeSessions = sessions.filter((s) => s.agent === 'claude-code');
  if (claudeSessions.length === 0) return null;

  // Group sessions by project path
  const projectSessions = new Map<string, SessionData[]>();
  for (const session of sessions) {
    const existing = projectSessions.get(session.projectPath);
    if (existing) {
      existing.push(session);
    } else {
      projectSessions.set(session.projectPath, [session]);
    }
  }

  const findings: ClaudeMdEvidence[] = [];
  let totalOverhead = 0;

  for (const [projectPath, projectSessionList] of projectSessions) {
    try {
      const claudeMdPath = join(projectPath, 'CLAUDE.md');
      const content = await readFile(claudeMdPath, 'utf-8');

      const tokenCount = estimateTokens(content);
      const issues: string[] = [];

      // Check for oversized files
      if (tokenCount > 5000) {
        issues.push('Very large CLAUDE.md (>5K tokens)');
      } else if (tokenCount > 2000) {
        issues.push('Large CLAUDE.md (>2K tokens)');
      }

      // Check for config duplication
      issues.push(...detectConfigDuplication(content));

      // Check for skill candidates
      issues.push(...detectSkillCandidates(content));

      if (issues.length > 0 || tokenCount > 2000) {
        // Calculate overhead: token count * number of sessions * average turns
        const avgTurns = projectSessionList.reduce((sum, s) => sum + s.turnCount, 0) / projectSessionList.length;
        const overhead = Math.round(tokenCount * projectSessionList.length * avgTurns * 0.1);
        totalOverhead += overhead;

        findings.push({
          project: projectSessionList[0]?.project ?? 'unknown',
          path: claudeMdPath,
          tokenCount,
          sizeBytes: content.length,
          issues,
          estimatedOverhead: overhead,
          sessionsAffected: projectSessionList.length,
        });
      }
    } catch {
      // CLAUDE.md doesn't exist or can't be read
    }
  }

  if (findings.length === 0) return null;

  // Sort by overhead
  findings.sort((a, b) => b.estimatedOverhead - a.estimatedOverhead);

  const totalTokens = claudeSessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );
  const savingsPercent = totalTokens > 0 ? Math.round((totalOverhead / totalTokens) * 100) : 0;

  const severity: 'high' | 'medium' | 'low' =
    savingsPercent > 10 ? 'high' : savingsPercent > 5 ? 'medium' : 'low';

  let confidence = Math.min(0.85, 0.5 + findings.length * 0.05);

  // Adjust confidence for estimated tokens
  confidence = adjustConfidenceForEstimates(confidence, sessions);

  const remediation = buildClaudeMdRemediation(findings);

  const sessionBreakdown = findings.slice(0, 5).map((f) => {
    const issueList = f.issues.length > 0 ? f.issues.slice(0, 2).join('; ') : 'oversized';
    return `**${f.project}**\n  - \`${f.path.replace(process.env.HOME ?? '', '~')}\`: **${f.tokenCount.toLocaleString()} tokens** (~${Math.round(f.sizeBytes / 1024)}KB), ${f.sessionsAffected} sessions affected\n  - Issues: ${issueList}`;
  }).join('\n\n');

  return {
    detector: 'claude-md-overhead',
    title: 'CLAUDE.md Overhead',
    severity,
    savingsPercent,
    savingsTokens: totalOverhead,
    confidence: Math.round(confidence * 100) / 100,
    evidence: {
      projectsWithIssues: findings.length,
      worstOffenders: findings.slice(0, 3),
    },
    remediation,
    sessionBreakdown: sessionBreakdown || '_No CLAUDE.md issues found._',
  };
}

function buildClaudeMdRemediation(findings: ClaudeMdEvidence[]): Remediation {
  const worst = findings[0];
  const hasConfigDuplication = findings.some((f) => f.issues.some((i) => i.includes('configuration')));
  const hasSkillCandidates = findings.some((f) => f.issues.some((i) => i.includes('skill')));
  const totalTokens = findings.reduce((sum, f) => sum + f.tokenCount, 0);

  return {
    problem: `CLAUDE.md is a configuration file (CLAUDE.md) that Claude reads at the start of every conversation in that directory. ${findings.length} project(s) have CLAUDE.md files that add unnecessary overhead to every conversation turn. ${worst ? `The worst offender ("${worst.project}") is ${worst.tokenCount.toLocaleString()} tokens (~${Math.round(worst.sizeBytes / 1024)}KB) and is injected into every API call. ` : ''}${hasConfigDuplication ? 'Some files duplicate information already in config files (eslintrc, tsconfig, etc.) — Claude can read those directly. ' : ''}${hasSkillCandidates ? 'Some files contain step-by-step procedures better suited as on-demand instruction files. ' : ''}Every token in a system prompt is paid for on every single turn — so oversized CLAUDE.md files create a fixed, recurring cost that compounds across sessions.`,

    whyItMatters: `CLAUDE.md content is part of the system prompt, meaning every token in it is charged on every single turn of every conversation. A ${totalTokens.toLocaleString()}-token CLAUDE.md costs that many tokens per turn — in a 20-turn session, that's ${(totalTokens * 20).toLocaleString()} tokens just for CLAUDE.md content, multiplied across ${findings.reduce((sum, f) => sum + f.sessionsAffected, 0)} affected sessions. Unlike file reads (which happen once and only when needed), this cost repeats on every single API call. Large CLAUDE.md files also crowd out space for actual conversation context and can cause Claude to lose focus on instructions buried in a wall of text.`,

    steps: [
      {
        action: 'Audit and trim your CLAUDE.md to essentials',
        howTo: 'Keep only: project-specific conventions Claude can\'t infer from the code, non-obvious architectural decisions, and critical constraints. Remove: obvious patterns Claude already follows, information available in config files, and general coding best practices. Aim for under 1,000 tokens (~3,500 characters). Every token you keep is paid for on every turn.',
        impact: `Reducing from ${totalTokens.toLocaleString()} to ~1,000 tokens saves ${((totalTokens - 1000) * 20).toLocaleString()} tokens in a 20-turn session.`,
      },
      ...(hasConfigDuplication ? [{
        action: 'Remove config duplication',
        howTo: 'Don\'t repeat ESLint rules, TypeScript settings, or test configuration in CLAUDE.md. Claude can read these files directly when needed. Instead, write: "Follow existing ESLint and TypeScript configurations." One sentence replaces hundreds of tokens that would otherwise be charged on every turn.',
        impact: 'Typically removes 200-800 tokens of duplicated config content.',
      }] : []),
      ...(hasSkillCandidates ? [{
        action: 'Move procedures to on-demand instruction files',
        howTo: 'Step-by-step processes (deployment checklists, PR review procedures, release workflows) should live in on-demand instruction files, not CLAUDE.md. On-demand instruction files are loaded only when invoked, not on every turn. Move procedural content to separate files that Claude reads only when needed.',
        impact: 'On-demand instruction files eliminate per-turn overhead for content that\'s only needed occasionally — you pay for it only when it\'s used.',
      }] : []),
      {
        action: 'Use hierarchical CLAUDE.md files',
        howTo: 'Put project-wide instructions in the root CLAUDE.md and module-specific instructions in subdirectory CLAUDE.md files. Claude only loads the relevant CLAUDE.md based on the working context, reducing overhead when working on specific modules.',
        impact: 'Distributes instructions so only relevant ones are loaded per context, reducing per-turn token overhead.',
      },
    ],

    examples: [
      {
        label: 'Config duplication removal',
        before: '```\n## TypeScript Rules\n- Use strict mode\n- No any types\n- Use interfaces over types\n- Enable strict null checks\n```\n(~200 tokens, charged on every single turn)',
        after: '```\nFollow tsconfig.json strict settings.\n```\n(~10 tokens, Claude reads tsconfig when needed)',
      },
      {
        label: 'Procedure to on-demand instruction file',
        before: 'CLAUDE.md: "## Deployment Checklist\\n1. Run tests\\n2. Build\\n3. Tag version\\n..." (~500 tokens, charged every turn even when not deploying)',
        after: 'Moved to a separate instruction file, loaded only when deployment is discussed (~0 tokens per turn, ~500 on demand)',
      },
    ],

    quickWin: 'Open your largest CLAUDE.md and delete any lines that describe standard coding practices (like "use meaningful variable names" or "write clean code"). These add overhead on every turn without changing Claude\'s behavior.',
    specificQuickWin: (() => {
      const worst = findings[0];
      if (!worst) return 'Trim your CLAUDE.md to essentials — aim for under 1,000 tokens.';
      const issueList = worst.issues.slice(0, 2).join('; ');
      return `Your heaviest CLAUDE.md: **${worst.project}** at ${worst.tokenCount.toLocaleString()} tokens (~${Math.round(worst.sizeBytes / 1024)}KB) — every single one charged on every turn. Issues: ${issueList || 'oversized'}. Open ${worst.path.replace(process.env.HOME ?? '', '~')} and cut anything that duplicates config files or describes general coding practices.`;
    })(),
    effort: 'moderate',
  };
}

// Wrapper for sync interface
export function detectClaudeMdOverheadSync(_sessions: SessionData[]): DetectorResult | null {
  // For sync usage, we'll return a placeholder
  // The async version should be used in the registry
  return null;
}
