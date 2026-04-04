/**
 * Best Practices Detector
 *
 * Agent-aware detector that invokes adapter-specific best practice checks.
 * Each adapter defines its own optimization recommendations and detection logic.
 */

import type { SessionData, DetectorResult, Remediation, AgentContext } from '../types.js';
import { getAgentName, getAgentBestPractices } from './agent-context.js';
import type { BestPractice } from '../agents/types.js';

interface BestPracticeEvidence {
  agentViolations: Array<{
    agentId: string;
    agentName: string;
    violations: Array<{
      practice: BestPractice;
      affectedSessions: number;
      examples: Array<{
        slug: string;
        project: string;
        date: string;
      }>;
    }>;
  }>;
  totalViolations: number;
  totalAgents: number;
}

export function detectBestPractices(
  sessions: SessionData[],
  agentContext?: AgentContext
): DetectorResult | null {
  if (sessions.length === 0) return null;

  const context = agentContext;
  if (!context || context.agentIds.length === 0) return null;

  const violations: BestPracticeEvidence['agentViolations'] = [];
  let totalViolations = 0;

  // Check each agent's best practices
  for (const agentId of context.agentIds) {
    const practices = getAgentBestPractices(agentId);
    if (practices.length === 0) continue;

    const agentSessions = sessions.filter((s) => s.agent === agentId);
    if (agentSessions.length === 0) continue;

    const agentViolations: BestPracticeEvidence['agentViolations'][number]['violations'] = [];

    for (const practice of practices) {
      // Check if this practice has a detection function
      if (!practice.detectFn) continue;

      const affectedSessions = agentSessions.filter((s) => practice.detectFn!(s));

      if (affectedSessions.length > 0) {
        totalViolations++;

        agentViolations.push({
          practice,
          affectedSessions: affectedSessions.length,
          examples: affectedSessions.slice(0, 3).map((s) => ({
            slug: s.slug,
            project: s.project,
            date: s.startedAt.split('T')[0] ?? '',
          })),
        });
      }
    }

    if (agentViolations.length > 0) {
      violations.push({
        agentId,
        agentName: getAgentName(agentId),
        violations: agentViolations,
      });
    }
  }

  if (violations.length === 0) return null;

  // Estimate token savings (conservative: 5% per violation type)
  const totalTokens = sessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );

  const savingsPercent = Math.min(15, totalViolations * 5);
  const savingsTokens = Math.round((totalTokens * savingsPercent) / 100);

  // Severity based on violation count
  const severity: 'high' | 'medium' | 'low' =
    totalViolations > 5 ? 'high' : totalViolations > 2 ? 'medium' : 'low';

  const evidence: BestPracticeEvidence = {
    agentViolations: violations,
    totalViolations,
    totalAgents: violations.length,
  };

  const remediation = buildBestPracticeRemediation(evidence);

  // Build session breakdown
  const sessionBreakdown = evidence.agentViolations
    .map((agent) => {
      const practiceLines = agent.violations.map((v) =>
        `  - **${v.practice.title}**: ${v.affectedSessions} sessions affected${v.examples.length > 0 ? ` (e.g., ${v.examples[0]?.project}, ${v.examples[0]?.date})` : ''}`
      ).join('\n');
      return `**${agent.agentName}**\n${practiceLines}`;
    })
    .join('\n\n');

  return {
    detector: 'best-practices',
    title: 'Agent Best Practices',
    severity,
    savingsPercent,
    savingsTokens,
    confidence: 0.7,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdown || '_No specific sessions to call out._',
  };
}

function buildBestPracticeRemediation(evidence: BestPracticeEvidence): Remediation {
  const agentSummary = evidence.agentViolations
    .map((a) => `**${a.agentName}**: ${a.violations.length} issue${a.violations.length > 1 ? 's' : ''}`)
    .join('; ');

  const allPractices = evidence.agentViolations.flatMap((a) => a.violations.map((v) => v.practice));

  return {
    problem: `Across ${evidence.totalAgents} agent${evidence.totalAgents > 1 ? 's' : ''}, ${evidence.totalViolations} best practice recommendation${evidence.totalViolations > 1 ? 's are' : ' is'} not being followed. ${agentSummary}. These are agent-specific optimizations that can reduce token usage, improve code quality, and streamline your workflow.`,

    whyItMatters: `Each agent has unique features and optimal workflows. Following agent-specific best practices ensures you're getting the most value from each tool. For example, Claude Code's /compact command can prevent context snowball, while Cursor's .cursorrules file provides project-specific guidance. Ignoring these practices leads to inefficient sessions and higher costs.`,

    steps: allPractices.slice(0, 5).map((practice) => ({
      action: practice.title,
      howTo: practice.description,
      impact: `Estimated ${practice.severity === 'high' ? 'significant' : practice.severity === 'medium' ? 'moderate' : 'minor'} token savings and workflow improvement.`,
    })),

    examples: [
      {
        label: 'Claude Code: Use /compact',
        before: 'Long session without /compact: context grows from 10K to 100K tokens, re-processing stale data on every turn.',
        after: 'Use /compact after each logical work unit: context stays under 20K, faster and cheaper.',
      },
      {
        label: 'Cursor: Use .cursorrules',
        before: 'Repeatedly explaining coding standards in every conversation.',
        after: 'Create .cursorrules with project conventions: Cursor automatically applies them.',
      },
    ],

    quickWin: 'Pick the highest-impact recommendation from your agent(s) and implement it today. Check back in a week to see the improvement in token usage.',
    specificQuickWin: (() => {
      const topIssue = evidence.agentViolations[0]?.violations[0];
      if (!topIssue) return 'Review the agent-specific recommendations above and implement the highest-impact ones.';
      return `Start with **${topIssue.practice.title}** for **${evidence.agentViolations[0]?.agentName}**: ${topIssue.practice.description}`;
    })(),
    effort: 'moderate',
  };
}
