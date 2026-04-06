/**
 * Combined Prompt Output Renderer
 *
 * Renders model recommendation + prompt quality grade in a single compact output.
 */

import type { RouteDecision, AuditReport } from './types.js';

export function renderPromptOutput(decision: RouteDecision, report: AuditReport): string {
  const lines: string[] = [];

  // Model recommendation line
  const modelShort = decision.model.replace('claude-', '').replace('-4-6', '').replace('-4-20250514', '');
  const confidence = `${(decision.confidence * 100).toFixed(0)}%`;
  lines.push(`Model:   ${modelShort} (${confidence}) — ${decision.reason.toLowerCase()}`);

  // Grade line
  const gradeEmoji = report.grade === 'A' ? '' : report.grade === 'B' ? '' : report.grade === 'C' ? '' : '';
  const gradeLabel = report.grade === 'A'
    ? 'clean prompt'
    : `${report.findings.length} finding${report.findings.length !== 1 ? 's' : ''}`;
  lines.push(`Grade:   ${gradeEmoji}${report.grade} — ${gradeLabel}`);

  // Savings line
  if (decision.estimatedSavings.includes('80%')) {
    lines.push(`Savings: ~80% vs opus`);
  } else if (report.totalEstimatedSavings > 0) {
    lines.push(`Waste:   ~${report.totalEstimatedSavings.toLocaleString()} tokens`);
  }

  // Findings (if any)
  if (report.findings.length > 0) {
    lines.push('');
    for (const finding of report.findings) {
      const tag = `[${finding.severity}]`;
      lines.push(`  ${tag} ${finding.title} — ${finding.suggestion.split('.')[0]}`);
    }
  }

  return lines.join('\n');
}
