/**
 * Prompt Auditor
 *
 * Analyzes prompts for waste patterns and provides actionable suggestions.
 * Built-in rules detect common token inefficiencies.
 */

import type { AuditRule, AuditFinding, AuditContext, AuditReport, AuditGrade, AuditSeverity } from './types.js';

// Default context values
const DEFAULT_MAX_CODE_BLOCK_LINES = 30;
const DEFAULT_MAX_STACK_FRAMES = 15;

/**
 * Built-in audit rules for detecting prompt waste patterns.
 */
export const BUILT_IN_RULES: AuditRule[] = [
  {
    id: 'redundant-file-paste',
    title: 'Redundant File Paste',
    severity: 'warning',
    check: (prompt: string) => {
      // Detect code blocks > 30 lines
      const codeBlockMatch = prompt.match(/```[\s\S]*?```/g);
      if (!codeBlockMatch) return null;

      for (const block of codeBlockMatch) {
        const lines = block.split('\n').length;
        if (lines > DEFAULT_MAX_CODE_BLOCK_LINES) {
          return {
            ruleId: 'redundant-file-paste',
            title: 'Redundant File Paste',
            severity: 'warning' as AuditSeverity,
            description: `Code block is ${lines} lines. Large pastes waste tokens.`,
            suggestion: 'Reference the file path instead. Claude can read files directly using the Read tool.',
            estimatedSavings: (lines - DEFAULT_MAX_CODE_BLOCK_LINES) * 20, // ~20 tokens per line
          };
        }
      }

      return null;
    },
  },
  {
    id: 'verbose-error-log',
    title: 'Verbose Error Log',
    severity: 'info',
    check: (prompt: string) => {
      // Detect stack traces > 15 frames
      const stackTraceMatch = prompt.match(/at\s+\w+\s+\(.+?\)/g);
      if (!stackTraceMatch) return null;

      const frameCount = stackTraceMatch.length;
      if (frameCount > DEFAULT_MAX_STACK_FRAMES) {
        return {
          ruleId: 'verbose-error-log',
          title: 'Verbose Error Log',
          severity: 'info' as AuditSeverity,
          description: `Stack trace has ${frameCount} frames. Most are unnecessary.`,
          suggestion: `Trim to first 10 + last 5 frames. Only the entry point and error location matter.`,
          estimatedSavings: (frameCount - DEFAULT_MAX_STACK_FRAMES) * 15,
        };
      }

      return null;
    },
  },
  {
    id: 'no-specificity',
    title: 'Low Specificity Prompt',
    severity: 'info',
    check: (prompt: string) => {
      const words = prompt.trim().split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;

      // Check for file references
      const hasFileRef = /[\w\-./]+\.(ts|js|py|go|rs|java)/.test(prompt);
      // Check for function references
      const hasFunctionRef = /[\w]+\(\)/.test(prompt);

      if (wordCount < 10 && !hasFileRef && !hasFunctionRef) {
        return {
          ruleId: 'no-specificity',
          title: 'Low Specificity Prompt',
          severity: 'info' as AuditSeverity,
          description: `Prompt is only ${wordCount} words with no file or function references.`,
          suggestion: 'Add specific file paths, function names, and expected outcomes to reduce clarification rounds.',
          estimatedSavings: 200, // Estimated back-and-forth savings
        };
      }

      return null;
    },
  },
  {
    id: 'over-scoped-request',
    title: 'Over-Scoped Request',
    severity: 'warning',
    check: (prompt: string) => {
      const overScopedPatterns = [
        /fix\s+all/gi,
        /refactor\s+everything/gi,
        /update\s+the\s+whole/gi,
        /change\s+all\s+the/gi,
      ];

      for (const pattern of overScopedPatterns) {
        if (pattern.test(prompt)) {
          return {
            ruleId: 'over-scoped-request',
            title: 'Over-Scoped Request',
            severity: 'warning' as AuditSeverity,
            description: 'Prompt asks for broad changes across many files.',
            suggestion: 'Scope the work to specific files or modules. Break into smaller, focused tasks.',
            estimatedSavings: 500, // Large scoping creates long responses
          };
        }
      }

      return null;
    },
  },
  {
    id: 'duplicate-context',
    title: 'Duplicate Context',
    severity: 'info',
    check: (prompt: string) => {
      // Split into sentences
      const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));

      if (sentences.length > uniqueSentences.size) {
        const duplicateCount = sentences.length - uniqueSentences.size;
        return {
          ruleId: 'duplicate-context',
          title: 'Duplicate Context',
          severity: 'info' as AuditSeverity,
          description: `${duplicateCount} sentences are duplicates or near-duplicates.`,
          suggestion: 'Remove redundant context. Each point should be stated once.',
          estimatedSavings: duplicateCount * 50,
        };
      }

      return null;
    },
  },
];

/**
 * Audit a prompt for waste patterns.
 */
export function auditPrompt(prompt: string, _context?: AuditContext): AuditReport {
  const findings: AuditFinding[] = [];

  // Run all rules
  for (const rule of BUILT_IN_RULES) {
    try {
      const finding = rule.check(prompt);
      if (finding) {
        findings.push(finding);
      }
    } catch {
      // Skip rules that error
      continue;
    }
  }

  // Calculate grade
  const grade = calculateGrade(findings);

  // Count by severity
  const severityCounts = {
    critical: findings.filter(f => f.severity === 'critical').length,
    warning: findings.filter(f => f.severity === 'warning').length,
    info: findings.filter(f => f.severity === 'info').length,
  };

  // Calculate total savings
  const totalEstimatedSavings = findings.reduce((sum, f) => sum + f.estimatedSavings, 0);

  return {
    grade,
    findings,
    totalEstimatedSavings,
    severityCounts,
  };
}

/**
 * Calculate audit grade based on findings.
 */
function calculateGrade(findings: AuditFinding[]): AuditGrade {
  const hasCritical = findings.some(f => f.severity === 'critical');
  const warningCount = findings.filter(f => f.severity === 'warning').length;
  const infoCount = findings.filter(f => f.severity === 'info').length;

  if (hasCritical) return 'D';
  if (warningCount >= 2) return 'C';
  if (warningCount >= 1 || infoCount >= 2) return 'B';
  return 'A';
}

/**
 * Render audit output as formatted text.
 */
export function renderAuditOutput(report: AuditReport): string {
  const lines: string[] = [];

  // Grade banner
  const gradeEmoji = report.grade === 'A' ? '🟢' : report.grade === 'B' ? '🟡' : report.grade === 'C' ? '🟠' : '🔴';
  lines.push(`${gradeEmoji} Prompt Quality: ${report.grade}`);
  lines.push('');

  // Summary
  if (report.findings.length === 0) {
    lines.push('✅ No issues detected. Your prompt is well-optimized!');
  } else {
    lines.push(`Found ${report.findings.length} issue(s):`);
    lines.push('');

    // List findings
    for (const finding of report.findings) {
      const emoji = finding.severity === 'critical' ? '🔴' : finding.severity === 'warning' ? '🟠' : '🟡';
      lines.push(`${emoji} ${finding.title}`);
      lines.push(`  ${finding.description}`);
      lines.push(`  💡 ${finding.suggestion}`);
      lines.push(`  📊 Saves ~${finding.estimatedSavings} tokens`);
      lines.push('');
    }

    // Total savings
    lines.push(`**Total Estimated Savings: ~${report.totalEstimatedSavings} tokens**`);
  }

  return lines.join('\n').trim();
}
