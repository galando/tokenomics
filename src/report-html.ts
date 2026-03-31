/**
 * HTML Report Generator for Tokenomics v3 — MagicUI Edition
 *
 * Purpose-built Bento Grid redesign with 8 MagicUI-inspired pure CSS/JS effects:
 * 1. Bento Grid        — CSS Grid named areas as primary layout (asymmetric)
 * 2. Border Beam       — rotating conic-gradient animated border on health score card
 * 3. Number Ticker     — count-up animation via requestAnimationFrame on metric values
 * 4. Animated Gradient Text — background-clip:text color sweep on the main title
 * 5. Dot Pattern       — radial-gradient dot grid on body::before (background texture)
 * 6. Ripple            — 3 concentric pulse rings behind health SVG circle (score < 80)
 * 7. Shine Border      — conic-gradient sweep on open findings <details> rows
 * 8. Typing Animation  — "ANALYSIS COMPLETE" types out via setInterval in the header
 *
 * No npm dependencies. No React. No external CDN. Single self-contained HTML output.
 */

import type { AnalysisOutput, DetectorResult, Remediation, Severity } from './types.js';

// ============================================================================
// Utility Functions (copied verbatim from report-html.ts)
// ============================================================================

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(md: string): string {
  const escaped = escapeHtml(md);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^  - (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

function severityConfig(s: Severity): { label: string; color: string; glow: string; explanation: string } {
  switch (s) {
    case 'high':
      return { label: 'HIGH COST', color: '#ff4d6a', glow: 'rgba(255,77,106,0.4)', explanation: 'Significant token waste — fix this first for biggest savings' };
    case 'medium':
      return { label: 'MODERATE', color: '#ffbe2e', glow: 'rgba(255,190,46,0.3)', explanation: 'Noticeable waste — worth addressing for better efficiency' };
    case 'low':
      return { label: 'LOW', color: '#22d3ee', glow: 'rgba(34,211,238,0.25)', explanation: 'Minor waste — fix when convenient for incremental savings' };
  }
}

function calculateHealthScore(findings: DetectorResult[]): { score: number; grade: string; color: string } {
  const penaltyPerSeverity: Record<Severity, number> = { high: 18, medium: 10, low: 4 };
  const penalty = findings.reduce(
    (sum, f) => sum + penaltyPerSeverity[f.severity],
    0
  );
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  let grade: string;
  let color: string;
  if (score >= 90) { grade = 'A'; color = '#34d399'; }
  else if (score >= 80) { grade = 'B'; color = '#22d3ee'; }
  else if (score >= 65) { grade = 'C'; color = '#ffbe2e'; }
  else if (score >= 50) { grade = 'D'; color = '#fb923c'; }
  else { grade = 'F'; color = '#ff4d6a'; }

  return { score, grade, color };
}

const DETECTOR_DESCRIPTIONS: Record<string, string> = {
  'context-snowball': 'Context grows unboundedly when conversation history accumulates without compaction, making each turn more expensive.',
  'model-selection': 'Using the most expensive AI model for tasks that a cheaper model handles equally well.',
  'file-read-waste': 'Re-reading files that Claude already has in context, or reading files speculatively without need.',
  'bash-output-bloat': 'Running commands that produce large output, all of which permanently enters the conversation context.',
  'vague-prompts': 'Starting conversations with unclear instructions, forcing exploration loops that waste tokens.',
  'session-timing': 'Running sessions too long without clearing context, causing compounding token costs.',
  'subagent-opportunity': 'Doing exploration directly in the main conversation instead of delegating to isolated sub-sessions.',
  'claude-md-overhead': 'Large configuration files (CLAUDE.md) that are loaded into every conversation turn, even when irrelevant.',
  'mcp-tool-tax': 'External tool servers (MCP) loaded on every session but rarely used, adding overhead to each turn.',
};

// ============================================================================
// SVG Generators
// ============================================================================

function getGradeExplanation(grade: string, score: number): string {
  const explanations: Record<string, string> = {
    'A': `Score ${score}/100 — Excellent. Your token usage is highly efficient. Claude Code sessions show minimal waste, good caching habits, and appropriate model selection. Keep doing what you're doing.`,
    'B': `Score ${score}/100 — Good. Minor optimization opportunities exist. You're using tokens wisely overall, but there are small habits (like clearing context or using subagents) that could push this to an A.`,
    'C': `Score ${score}/100 — Moderate waste detected. Noticeable token drain from patterns like long sessions without context resets, reading files already in context, or running expensive commands with large output. Addressing 1-2 habits would yield significant savings.`,
    'D': `Score ${score}/100 — Significant waste. Multiple inefficiency patterns are compounding — context snowballing, vague prompts, or unused MCP servers loading on every turn. Running \`tokenomics --fix\` and adjusting a few habits could cut token usage substantially.`,
    'F': `Score ${score}/100 — High waste. Sessions show several overlapping inefficiency patterns that compound over time. The good news: this means large savings are possible. Start with the auto-fixable items and the quick wins listed below.`,
  };
  return explanations[grade] ?? `Score ${score}/100 — Analyze your sessions for optimization opportunities.`;
}

function renderHealthRing(score: number, color: string, grade: string): string {
  const circumference = 2 * Math.PI * 54;
  const progress = (score / 100) * circumference;

  return `<div class="health-ring-container">
    <svg viewBox="0 0 120 120" class="health-ring">
      <circle cx="60" cy="60" r="54" fill="none" stroke="var(--grid-line)" stroke-width="6" />
      <circle cx="60" cy="60" r="54" fill="none" stroke="${color}" stroke-width="6"
        stroke-dasharray="${progress.toFixed(1)} ${(circumference - progress).toFixed(1)}"
        stroke-dashoffset="${(circumference * 0.25).toFixed(1)}"
        stroke-linecap="round"
        class="ring-progress"
        style="filter: drop-shadow(0 0 8px ${color})" />
      <text x="60" y="52" text-anchor="middle" class="ring-score" fill="${color}">${score}</text>
      <text x="60" y="68" text-anchor="middle" class="ring-grade">GRADE ${grade}</text>
    </svg>
    <div class="health-label">EFFICIENCY INDEX</div>
    <div class="health-explanation">${getGradeExplanation(grade, score)}</div>
  </div>`;
}

function renderDonutChart(input: number, output: number, cacheRead: number, cacheCreation: number): string {
  const total = input + output + cacheRead + cacheCreation;
  if (total === 0) return '<div class="chart-empty">NO DATA</div>';

  const segments = [
    { label: 'INPUT', value: input, color: '#22d3ee', desc: 'New tokens sent to Claude (prompts, code, tool results) — you pay full price for these' },
    { label: 'OUTPUT', value: output, color: '#a78bfa', desc: 'Tokens Claude generated (responses, code, tool calls) — the most expensive token type' },
    { label: 'CACHE READ', value: cacheRead, color: '#34d399', desc: 'Input tokens served from cache at 90% discount — high % here means good cost efficiency' },
    { label: 'CACHE WRITE', value: cacheCreation, color: '#ffbe2e', desc: 'Tokens written to cache for future reuse — a one-time cost that pays off in later turns' },
  ].filter(s => s.value > 0);

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const paths = segments.map(seg => {
    const pct = seg.value / total;
    const dash = circumference * pct;
    const gap = circumference - dash;
    const el = `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${seg.color}" stroke-width="14" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)" class="donut-segment" style="filter: drop-shadow(0 0 4px ${seg.color}40)" />`;
    offset += dash;
    return el;
  });

  const legend = segments.map(seg => {
    const pct = ((seg.value / total) * 100).toFixed(1);
    return `<div class="legend-item" data-tooltip="${escapeHtml(seg.desc)}">
      <span class="legend-dot" style="background:${seg.color};box-shadow:0 0 6px ${seg.color}60"></span>
      <span class="legend-label">${seg.label}</span>
      <span class="legend-value">${fmt(seg.value)} <span class="legend-pct">${pct}%</span></span>
    </div>`;
  }).join('');

  return `<div class="donut-container">
  <svg viewBox="0 0 120 120" class="donut-chart">
    ${paths.join('\n    ')}
    <text x="60" y="56" text-anchor="middle" class="donut-total">${fmt(total)}</text>
    <text x="60" y="70" text-anchor="middle" class="donut-label">TOKENS</text>
  </svg>
  <div class="donut-legend">
    ${legend}
    <div class="legend-hint">Hover each category for details. Cache reads are 90% cheaper than regular input.</div>
  </div>
</div>`;
}

function renderSavingsBar(findings: DetectorResult[]): string {
  if (findings.length === 0) return '';
  const totalSavingsTokens = findings.reduce((sum, f) => sum + f.savingsTokens, 0);

  const bars = findings.map((f, i) => {
    const widthPct = totalSavingsTokens > 0 ? (f.savingsTokens / totalSavingsTokens) * 100 : 0;
    const sev = severityConfig(f.severity);
    const description = DETECTOR_DESCRIPTIONS[f.detector] ?? f.remediation.problem.slice(0, 120);
    return `<div class="bar-row" style="animation-delay:${i * 80}ms">
  <span class="bar-label"><span class="bar-label-text" data-tooltip="${escapeHtml(description)}">${escapeHtml(f.title)} <span class="bar-info">&#9432;</span></span></span>
  <div class="bar-track">
    <div class="bar-fill" style="width:${widthPct.toFixed(1)}%;background:${sev.color};box-shadow:0 0 8px ${sev.glow}"></div>
  </div>
  <span class="bar-value" style="color:${sev.color}">~${fmt(f.savingsTokens)}</span>
</div>`;
  }).join('\n');

  return `<div class="savings-bars">${bars}</div>`;
}

// ============================================================================
// Section Renderers
// ============================================================================

function renderHeader(metadata: AnalysisOutput['metadata']): string {
  const days = Math.round(
    (new Date(metadata.dateRange.end).getTime() - new Date(metadata.dateRange.start).getTime()) / 86_400_000
  ) || 30;
  const dateStr = new Date(metadata.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });

  return `<header class="cmd-header">
  <div class="cmd-header-top">
    <div class="cmd-brand">
      <div class="cmd-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div class="cmd-titles">
        <h1 class="cmd-title gradient-text">TOKENOMICS</h1>
        <p class="cmd-subtitle">${metadata.sessionCount} sessions // ${days} day range // ${dateStr}</p>
      </div>
    </div>
    <div class="cmd-controls">
      <div class="cmd-status">
        <span class="status-dot"></span>
        <span class="typing-status">ANALYSIS COMPLETE</span>
      </div>
      <button class="cmd-theme-btn" onclick="toggleTheme()" title="Toggle theme">
        <svg viewBox="0 0 24 24" class="icon-theme" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
        <svg viewBox="0 0 24 24" class="icon-theme-alt" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
    </div>
  </div>
  <nav class="cmd-nav">
    <a href="#overview" class="cmd-nav-link active" data-section="overview">Overview</a>
    <a href="#findings" class="cmd-nav-link" data-section="findings">Findings</a>
    <a href="#actions" class="cmd-nav-link" data-section="actions">Actions</a>
  </nav>
</header>`;
}

function renderDashboard(metadata: AnalysisOutput['metadata'], findings: DetectorResult[]): string {
  const { score, grade, color } = calculateHealthScore(findings);
  const totalTokens = metadata.totalTokens;
  const cacheHitRate = totalTokens.total > 0
    ? ((totalTokens.cacheRead / totalTokens.total) * 100).toFixed(1)
    : '0';
  const totalSavings = findings.reduce((s, f) => s + f.savingsPercent, 0);

  return `<section class="dashboard" id="overview">
  <div class="bento-grid">

    <!-- Health ring -->
    <div class="bento-card bento-health">
        ${renderHealthRing(score, color, grade)}
    </div>

    <!-- Sessions metric -->
    <div class="bento-card bento-sessions">
      <span class="metric-val"><span class="number-ticker" data-target="${metadata.sessionCount}">${formatNumber(metadata.sessionCount)}</span></span>
      <span class="metric-key">SESSIONS</span>
      <span class="metric-hint">Claude Code conversations analyzed</span>
    </div>

    <!-- Total tokens metric -->
    <div class="bento-card bento-tokens">
      <span class="metric-val"><span class="number-ticker" data-target="${totalTokens.total}" data-suffix="">${fmt(totalTokens.total)}</span></span>
      <span class="metric-key">TOTAL TOKENS</span>
      <span class="metric-hint">Input + output + cache across all sessions</span>
    </div>

    <!-- Cache hit rate metric -->
    <div class="bento-card bento-cache">
      <span class="metric-val"><span class="number-ticker" data-target="${parseFloat(cacheHitRate)}" data-suffix="%" data-decimals="1">${cacheHitRate}<span class="metric-unit">%</span></span></span>
      <span class="metric-key">CACHE HIT RATE</span>
      <span class="metric-hint">% of input tokens served from cache (higher = cheaper)</span>
      <span class="metric-bar" style="--bar-fill:${cacheHitRate}%;--bar-color:#34d399"></span>
    </div>

    <!-- Issues count metric -->
    <div class="bento-card bento-issues">
      <span class="metric-val"><span class="number-ticker" data-target="${findings.length}">${findings.length}</span></span>
      <span class="metric-key">ISSUES</span>
      <span class="metric-hint">Optimization opportunities detected</span>
    </div>

    <!-- Token breakdown donut -->
    <div class="bento-card bento-donut">
      <div class="panel-header">
        <span class="panel-tag">01</span>
        <h3 class="panel-title">TOKEN BREAKDOWN</h3>
      </div>
      <div class="panel-body">
        ${renderDonutChart(totalTokens.input, totalTokens.output, totalTokens.cacheRead, totalTokens.cacheCreation)}
      </div>
    </div>

    <!-- Potential savings bars -->
    <div class="bento-card bento-savings">
      <div class="panel-header">
        <span class="panel-tag">02</span>
        <h3 class="panel-title">POTENTIAL SAVINGS</h3>
      </div>
      <div class="panel-body">
        ${renderSavingsBar(findings)}
        <div class="savings-total">
          <span class="savings-total-label">COMBINED POTENTIAL</span>
          <span class="savings-total-value">~${totalSavings}% <span class="savings-total-unit">TOKEN REDUCTION</span></span>
        </div>
      </div>
    </div>

  </div>
</section>`;
}

function renderRemediationSteps(steps: Remediation['steps']): string {
  return steps.map((step, i) => `<div class="step" style="animation-delay:${i * 100}ms">
  <div class="step-num">${String(i + 1).padStart(2, '0')}</div>
  <div class="step-content">
    <div class="step-action">${escapeHtml(step.action)}</div>
    <div class="step-meta">
      <div class="step-how">
        <span class="step-badge step-badge--how">HOW</span>
        <span class="step-text">${escapeHtml(step.howTo)}</span>
      </div>
      <div class="step-impact">
        <span class="step-badge step-badge--impact">IMPACT</span>
        <span class="step-text">${escapeHtml(step.impact)}</span>
      </div>
    </div>
  </div>
</div>`).join('\n');
}

function renderBeforeAfter(examples: Remediation['examples']): string {
  if (examples.length === 0) return '';
  const items = examples.map(ex => `<div class="example-pair">
  <div class="example-side example-bad">
    <div class="example-tag">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.5 9.5l-1 1L8 9l-2.5 2.5-1-1L7 8 4.5 5.5l1-1L8 7l2.5-2.5 1 1L9 8l2.5 2.5z"/></svg>
      BEFORE
    </div>
    <code>${escapeHtml(ex.before)}</code>
  </div>
  <div class="example-side example-good">
    <div class="example-tag">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.78 5.28l-4.5 4.5a.75.75 0 01-1.06 0l-2-2a.75.75 0 011.06-1.06L6.75 9.94l3.97-3.97a.75.75 0 111.06 1.06z"/></svg>
      AFTER
    </div>
    <code>${escapeHtml(ex.after)}</code>
  </div>
</div>`).join('\n');

  return `<div class="examples-section">${items}</div>`;
}

function renderUnifiedFindings(findings: DetectorResult[]): string {
  if (findings.length === 0) {
    return '<section class="findings-unified" id="findings"><div class="panel"><div class="panel-body no-findings">NO SIGNIFICANT PATTERNS DETECTED</div></div></section>';
  }

  const findingRows = findings.map((f, i) => {
    const sev = severityConfig(f.severity);
    const problemSummary = f.remediation.problem.length > 100
      ? f.remediation.problem.slice(0, 97).replace(/\s+\S*$/, '') + '...'
      : f.remediation.problem;
    const effortLabel = f.remediation.effort === 'quick' ? '< 5 MIN' : f.remediation.effort === 'moderate' ? '5-30 MIN' : '30+ MIN';

    return `<details class="finding-unified-row" id="finding-${f.detector}">
  <summary class="finding-summary" style="animation-delay:${i * 60}ms">
    <div class="finding-col finding-col--sev">
      <span class="sev-indicator" style="background:${sev.color};box-shadow:0 0 8px ${sev.glow}"></span>
      <span class="sev-text" style="color:${sev.color}" data-tooltip="${escapeHtml(sev.explanation)}">${sev.label} <span class="bar-info">&#9432;</span></span>
    </div>
    <div class="finding-col finding-col--name">${escapeHtml(f.title)}</div>
    <div class="finding-col finding-col--savings">
      <span class="savings-pct" style="color:${sev.color}">~${f.savingsPercent}%</span>
      <span class="savings-detail">${fmt(f.savingsTokens)} tokens</span>
    </div>
    <div class="finding-col finding-col--conf">
      <div class="conf-bar"><div class="conf-fill" style="width:${Math.round(f.confidence * 100)}%;background:${sev.color}"></div></div>
      <span class="conf-text">${Math.round(f.confidence * 100)}%</span>
    </div>
    <div class="finding-col finding-col--summary">${escapeHtml(problemSummary)}</div>
    <div class="finding-col finding-col--chevron">
      <svg viewBox="0 0 24 24" class="chevron-icon" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </div>
  </summary>
  <div class="finding-expanded">
    <div class="finding-detail-grid">
      <div class="finding-section">
        <div class="section-tag"><span class="section-hash">#</span>EVIDENCE</div>
        <div class="section-content">${markdownToHtml(f.sessionBreakdown)}</div>
      </div>
      <div class="finding-section">
        <div class="section-tag"><span class="section-hash">#</span>COST ANALYSIS</div>
        <div class="section-content"><p>${escapeHtml(f.remediation.whyItMatters)}</p></div>
      </div>
    </div>
    <div class="finding-section">
      <div class="section-tag"><span class="section-hash">#</span>REMEDIATION</div>
      <div class="section-content">${renderRemediationSteps(f.remediation.steps)}</div>
    </div>
    <div class="quickwin-strip" style="border-color:${sev.color}40">
      <div class="quickwin-tag" style="background:${sev.color}18;color:${sev.color}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        QUICK WIN // ${effortLabel}
      </div>
      <div class="quickwin-text">${markdownToHtml(f.remediation.specificQuickWin)}</div>
    </div>
  </div>
</details>`;
  }).join('\n');

  return `<section class="findings-unified" id="findings">
  <div class="panel">
    <div class="panel-header">
      <span class="panel-tag">04</span>
      <h3 class="panel-title">FINDINGS</h3>
      <span class="panel-count">${findings.length} issue${findings.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="panel-body panel-body--flush">
      <div class="findings-thead">
        <span class="findings-th findings-th--sev">SEVERITY</span>
        <span class="findings-th findings-th--name">DETECTOR</span>
        <span class="findings-th findings-th--savings">SAVINGS</span>
        <span class="findings-th findings-th--conf" data-tooltip="How certain the detector is that this pattern is real, based on how many sessions show it and how consistently">CONFIDENCE</span>
        <span class="findings-th findings-th--summary">PROBLEM</span>
        <span class="findings-th findings-th--chevron"></span>
      </div>
      ${findingRows}
    </div>
  </div>
</section>`;
}

function renderFixSuggestions(findings: DetectorResult[]): string {
  const autoFixable = findings.filter(f => f.detector === 'model-selection' || f.detector === 'mcp-tool-tax');
  const manual = findings.filter(f => f.detector !== 'model-selection' && f.detector !== 'mcp-tool-tax');

  const autoFixItems = autoFixable.map(f => {
    const sev = severityConfig(f.severity);
    const step = f.remediation.steps[0];
    return `<li>
      <div class="action-item-header">
        <span class="sev-indicator" style="background:${sev.color};box-shadow:0 0 6px ${sev.glow}"></span>
        <span class="action-cmd">${escapeHtml(step?.action ?? f.title)}</span>
        <span class="action-savings" style="color:${sev.color}">~${f.savingsPercent}% savings</span>
      </div>
      <span class="action-detail">${escapeHtml(step?.impact ?? f.remediation.whyItMatters)}</span>
    </li>`;
  }).join('\n');

  const dynamicFixSteps: string[] = [];
  const hasModelSelection = autoFixable.some(f => f.detector === 'model-selection');
  const hasMcpTax = autoFixable.some(f => f.detector === 'mcp-tool-tax');

  dynamicFixSteps.push('Scans your last 30 days of Claude Code sessions for optimization opportunities');
  if (hasModelSelection) {
    dynamicFixSteps.push('Updates your settings to use Sonnet as the default model (5x cheaper for most tasks)');
  }
  if (hasMcpTax) {
    dynamicFixSteps.push('Removes MCP servers that were loaded every session but never actually used');
  }
  dynamicFixSteps.push('Reports exactly what changed and what still needs your manual attention');

  const manualItems = manual.slice(0, 5).map(f => {
    const sev = severityConfig(f.severity);
    const step = f.remediation.steps[0];
    if (!step) return '';
    return `<li>
      <div class="action-item-header">
        <span class="sev-indicator" style="background:${sev.color};box-shadow:0 0 6px ${sev.glow}"></span>
        <span class="action-cmd">${escapeHtml(step.action)}</span>
        <span class="action-savings" style="color:${sev.color}">~${f.savingsPercent}% savings</span>
      </div>
    </li>`;
  }).filter(Boolean).join('\n');

  return `<section class="fix-suggestions" id="actions">
  <div class="panel">
    <div class="panel-header">
      <span class="panel-tag">03</span>
      <h3 class="panel-title">ACTIONS</h3>
    </div>
    <div class="panel-body">
      <div class="actions-grid">
        <div class="action-card action-auto">
          <div class="action-card-header">
            <span class="action-status-dot" style="background:#34d399;box-shadow:0 0 8px rgba(52,211,153,0.5)"></span>
            <h4>AUTO-FIXABLE</h4>
          </div>
          ${autoFixable.length > 0
            ? `<p class="action-intro">These fixes run locally (no LLM needed) and edit your Claude configuration files directly.</p>
               <ul class="action-list">${autoFixItems}</ul>`
            : `<p class="action-intro">No auto-fixable issues detected in this scan. Run <code>tokenomics --fix</code> to check again after changing your workflow.</p>`}
          <div class="action-cli-block">
            <div class="action-cli-label">Run in your terminal:</div>
            <div class="action-cli action-cli--prominent">
              <div class="cli-prompt">$</div>
              <code>tokenomics --fix</code>
            </div>
            <div class="action-cli-options">
              <div class="cli-option"><code>tokenomics --fix --dry-run</code><span>Preview changes without writing files</span></div>
              <div class="cli-option"><code>tokenomics --fix --json</code><span>Machine-readable JSON output</span></div>
            </div>
            <div class="action-cli-steps">
              <div class="cli-step-title">What <code>--fix</code> does, step by step:</div>
              <ol class="cli-steps-list">
                ${dynamicFixSteps.map(s => `<li>${s}</li>`).join('\n                ')}
              </ol>
            </div>
          </div>
        </div>
        <div class="action-card action-manual">
          <div class="action-card-header">
            <span class="action-status-dot" style="background:#ffbe2e;box-shadow:0 0 8px rgba(255,190,46,0.5)"></span>
            <h4>BEHAVIORAL CHANGES</h4>
          </div>
          <p class="action-intro">These require changing how you interact with Claude. No script can automate these — they are habits that compound over time.</p>
          <ul class="action-list">
            ${manualItems || '<li><span class="action-detail">No behavioral changes needed — your patterns look efficient.</span></li>'}
          </ul>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function renderFooter(metadata: AnalysisOutput['metadata']): string {
  const dateStr = new Date(metadata.generatedAt).toLocaleString('en-US');
  return `<footer class="cmd-footer">
  <span class="footer-marker">&gt;_</span>
  <span>Generated ${dateStr}</span>
  <span class="footer-sep">|</span>
  <span>Tokenomics v${metadata.version}</span>
  <span class="footer-sep">|</span>
  <span class="footer-blink">READY</span>
</footer>`;
}

// ============================================================================
// CSS
// ============================================================================

function renderStyles(): string {
  return `<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');

/* ── Custom Properties ── */
:root {
  --bg-base: #111827;
  --bg-surface: #1e293b;
  --bg-elevated: #283548;
  --bg-hover: #334155;
  --grid-line: rgba(255,255,255,0.07);
  --grid-line-strong: rgba(255,255,255,0.12);
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent: #22d3ee;
  --accent-glow: rgba(34,211,238,0.15);
  --green: #34d399;
  --amber: #ffbe2e;
  --red: #ff4d6a;
  --purple: #a78bfa;
  --radius: 6px;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  --font-sans: 'DM Sans', system-ui, -apple-system, sans-serif;

  --dot-color: rgba(255,255,255,0.04);
}

[data-theme="light"] {
  --bg-base: #f8fafc;
  --bg-surface: #ffffff;
  --bg-elevated: #f1f5f9;
  --bg-hover: #e2e8f0;
  --grid-line: rgba(0,0,0,0.06);
  --grid-line-strong: rgba(0,0,0,0.12);
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --accent: #0891b2;
  --accent-glow: rgba(8,145,178,0.08);
  --green: #059669;
  --amber: #d97706;
  --red: #dc2626;
  --purple: #7c3aed;
  --dot-color: rgba(0,0,0,0.05);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { font-size: 14px; -webkit-font-smoothing: antialiased; scroll-behavior: smooth; }

body {
  font-family: var(--font-mono);
  background: var(--bg-base);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  position: relative;
}

/* ── Dot Pattern background ── */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: radial-gradient(circle, var(--dot-color) 1px, transparent 1px);
  background-size: 24px 24px;
  pointer-events: none;
  z-index: 0;
}

.report-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px 48px;
  position: relative;
  z-index: 1;
}

/* ── Title ── */
.gradient-text {
  background: linear-gradient(90deg, #22d3ee, #a78bfa, #34d399);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Health card (no animation) ── */

/* ── Health explanation ── */

/* ── Expanded findings highlight ── */
.finding-unified-row[open] {
  position: relative;
  box-shadow: 0 0 0 1px var(--accent);
}
}

/* ── Status text ── */
.typing-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ── MagicUI #3: Number Ticker ── */
.number-ticker {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  transition: none;
}

/* ── MagicUI #1: Bento Grid ── */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: auto auto;
  gap: 12px;
  margin-bottom: 16px;
}

.bento-health   { grid-column: span 2; grid-row: span 2; }
.bento-sessions { grid-column: span 2; }
.bento-tokens   { grid-column: span 2; }
.bento-cache    { grid-column: span 2; }
.bento-issues   { grid-column: span 2; }
.bento-donut    { grid-column: span 3; }
.bento-savings  { grid-column: span 3; }

/* Keep donut and savings panels equal height */
.bento-grid .bento-donut,
.bento-grid .bento-savings {
  display: flex;
  flex-direction: column;
}

.bento-card {
  background: var(--bg-surface);
  border: 1px solid var(--grid-line-strong);
  border-radius: var(--radius);
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  animation: bento-fade-in 0.5s ease backwards;
}

.bento-donut,
.bento-savings {
  align-items: stretch;
  text-align: left;
  padding: 0;
}

/* Stretch panel-body inside donut/savings so cards match height */
.bento-donut .panel-body,
.bento-savings .panel-body {
  flex: 1;
  padding: 20px;
}

.bento-donut .panel-body {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

@keyframes bento-fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.bento-health   { animation-delay: 0ms; }
.bento-sessions { animation-delay: 60ms; }
.bento-tokens   { animation-delay: 120ms; }
.bento-cache    { animation-delay: 180ms; }
.bento-issues   { animation-delay: 240ms; }
.bento-donut    { animation-delay: 300ms; }
.bento-savings  { animation-delay: 360ms; }

/* ── Header ── */
.cmd-header { margin-bottom: 32px; }

.cmd-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--grid-line-strong);
}

.cmd-brand { display: flex; align-items: center; gap: 14px; }

.cmd-logo {
  width: 36px; height: 36px;
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 6px;
}
.cmd-logo svg { width: 100%; height: 100%; }

.cmd-title {
  font-family: var(--font-sans);
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.cmd-subtitle {
  font-size: 0.72rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-top: 2px;
}

.cmd-controls { display: flex; align-items: center; gap: 16px; }

.cmd-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.7rem;
  color: var(--green);
  letter-spacing: 0.06em;
}

.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 8px rgba(52,211,153,0.6);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(52,211,153,0.6); }
  50% { opacity: 0.5; box-shadow: 0 0 4px rgba(52,211,153,0.3); }
}

.cmd-theme-btn {
  background: var(--bg-surface);
  border: 1px solid var(--grid-line-strong);
  border-radius: var(--radius);
  padding: 6px;
  cursor: pointer;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
  transition: all 0.2s;
}
.cmd-theme-btn:hover { border-color: var(--accent); color: var(--accent); }

.icon-theme, .icon-theme-alt { width: 18px; height: 18px; }
[data-theme="light"] .icon-theme { display: none; }
:not([data-theme]) .icon-theme-alt, [data-theme="light"] .icon-theme-alt { display: none; }
:not([data-theme]) .icon-theme, [data-theme="dark"] .icon-theme { display: block; }
[data-theme="dark"] .icon-theme-alt { display: none; }
[data-theme="light"] .icon-theme-alt { display: block; }

.cmd-nav {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--grid-line);
}

.cmd-nav-link {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  text-decoration: none;
  padding: 12px 20px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.cmd-nav-link:hover { color: var(--text-secondary); background: var(--bg-hover); }
.cmd-nav-link.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Metric blocks in bento cells ── */
.metric-val {
  font-family: var(--font-sans);
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  line-height: 1;
  margin-bottom: 6px;
}

.metric-unit {
  font-size: 0.9rem;
  color: var(--text-secondary);
  font-weight: 400;
}

.metric-key {
  font-size: 0.62rem;
  color: var(--text-muted);
  letter-spacing: 0.1em;
  font-weight: 500;
}

.metric-bar {
  width: 100%;
  height: 2px;
  background: var(--grid-line);
  margin-top: 10px;
  border-radius: 1px;
  position: relative;
  overflow: hidden;
}
.metric-bar::after {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: var(--bar-fill, 50%);
  background: var(--bar-color, var(--accent));
  border-radius: 1px;
  transition: width 1s ease;
}

.metric-hint { font-size: 0.6rem; color: var(--text-secondary); letter-spacing: 0.02em; margin-top: 6px; text-align: center; max-width: 180px; line-height: 1.4; font-family: var(--font-sans); }

/* Health Ring */
.health-ring-container { display: flex; flex-direction: column; align-items: center; }
.health-ring { width: 90px; height: 90px; }
.ring-progress { transition: stroke-dasharray 1.5s ease; }
.ring-score { font-size: 1.8rem; font-weight: 800; font-family: var(--font-sans); }
.ring-grade { font-size: 0.55rem; fill: var(--text-muted); letter-spacing: 0.12em; font-family: var(--font-mono); }
.health-label { font-size: 0.58rem; color: var(--text-muted); letter-spacing: 0.1em; margin-top: 6px; }
.health-hint { font-size: 0.56rem; color: var(--text-secondary); text-align: center; max-width: 180px; line-height: 1.5; margin-top: 4px; font-family: var(--font-sans); }
.health-explanation { font-size: 0.62rem; color: var(--text-secondary); text-align: center; max-width: 220px; line-height: 1.6; margin-top: 8px; font-family: var(--font-sans); }

/* ── Panels ── */
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--grid-line-strong);
  border-radius: var(--radius);
  overflow: visible;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--grid-line);
}

.panel-tag {
  font-size: 0.62rem;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  font-weight: 600;
  opacity: 0.6;
}

.panel-title {
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.panel-count {
  margin-left: auto;
  font-size: 0.65rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  background: var(--bg-elevated);
  padding: 2px 10px;
  border-radius: 10px;
}

.panel-body { padding: 20px; }
.panel-body--flush { padding: 0; }

/* ── Donut ── */
.donut-container { display: flex; gap: 24px; align-items: center; justify-content: center; width: 100%; min-height: 140px; }
.donut-chart { width: 130px; height: 130px; flex-shrink: 0; }
.donut-segment { transition: stroke-width 0.2s; }
.donut-total { font-size: 1rem; font-weight: 700; fill: var(--text-primary); font-family: var(--font-sans); }
.donut-label { font-size: 0.45rem; fill: var(--text-muted); letter-spacing: 0.12em; font-family: var(--font-mono); }
.donut-legend { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
.legend-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.legend-label { color: var(--text-muted); min-width: 70px; font-size: 0.68rem; letter-spacing: 0.05em; }
.legend-value { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.legend-pct { color: var(--text-muted); font-weight: 400; margin-left: 4px; }
.legend-hint { font-size: 0.6rem; color: var(--text-secondary); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--grid-line); line-height: 1.5; font-family: var(--font-sans); }

/* ── Savings Bars ── */
.savings-bars { display: flex; flex-direction: column; gap: 12px; }
.bar-row { display: grid; grid-template-columns: 130px 1fr 80px; gap: 10px; align-items: center; font-size: 0.72rem; animation: slideInRight 0.5s ease backwards; }
.bar-label { text-align: right; overflow: visible; white-space: nowrap; font-size: 0.7rem; }
.bar-label-text { color: var(--text-secondary); position: relative; }
.bar-info { opacity: 0.4; font-size: 0.6rem; margin-left: 2px; cursor: help; }
.bar-label-text:hover .bar-info { opacity: 1; color: var(--accent); }

/* Tooltip */
.tooltip-popup {
  position: fixed;
  z-index: 99999;
  background: var(--bg-elevated);
  border: 1px solid var(--grid-line-strong);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 0.72rem;
  color: var(--text-secondary);
  white-space: normal;
  width: 320px;
  max-width: 85vw;
  text-align: left;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  pointer-events: none;
  line-height: 1.7;
  font-family: var(--font-mono);
  opacity: 0;
  transition: opacity 0.15s;
}
.tooltip-popup.visible { opacity: 1; }
.tooltip-popup::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--grid-line-strong);
}
[data-tooltip] { cursor: help; }

.bar-track { height: 6px; background: var(--grid-line-strong); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 1.2s cubic-bezier(0.16,1,0.3,1); }
.bar-value { font-weight: 600; font-size: 0.72rem; font-variant-numeric: tabular-nums; }

.savings-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--grid-line);
}
.savings-total-label { font-size: 0.68rem; color: var(--text-muted); letter-spacing: 0.06em; }
.savings-total-value { font-family: var(--font-sans); font-size: 1.1rem; font-weight: 700; color: var(--green); }
.savings-total-unit { font-size: 0.6rem; color: var(--text-muted); font-weight: 400; margin-left: 4px; letter-spacing: 0.05em; }

/* ── Unified Findings ── */
.findings-unified { margin-bottom: 16px; }

.findings-thead {
  display: grid;
  grid-template-columns: 120px 1fr 100px 90px 1.5fr 32px;
  gap: 8px;
  padding: 10px 20px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--grid-line-strong);
}

.findings-th {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.finding-unified-row {
  border-bottom: 1px solid var(--grid-line);
  transition: background 0.15s;
}
.finding-unified-row:last-child { border-bottom: none; }
.finding-unified-row:hover { background: var(--bg-hover); }
.finding-unified-row[open] { background: var(--bg-elevated); }
.finding-unified-row[open] > .finding-summary { border-bottom: 1px solid var(--grid-line); }

.finding-summary {
  display: grid;
  grid-template-columns: 120px 1fr 100px 90px 1.5fr 32px;
  gap: 8px;
  padding: 14px 20px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  align-items: center;
  animation: fadeInRow 0.4s ease backwards;
  position: relative;
  z-index: 1;
}
.finding-summary::-webkit-details-marker { display: none; }

.finding-col { display: flex; align-items: center; }
.finding-col--sev { gap: 8px; }
.finding-col--name { font-weight: 600; color: var(--text-primary); font-size: 0.82rem; }
.finding-col--savings { flex-direction: column; align-items: flex-start; }
.finding-col--conf { gap: 6px; }
.finding-col--summary { color: var(--text-secondary); font-size: 0.72rem; line-height: 1.5; }
.finding-col--chevron { justify-content: center; }

.sev-indicator {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.sev-text { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em; }
.savings-pct { font-weight: 700; font-size: 0.82rem; }
.savings-detail { font-size: 0.62rem; color: var(--text-muted); margin-top: 2px; }
.conf-bar { width: 50px; height: 4px; background: var(--grid-line); border-radius: 2px; overflow: hidden; }
.conf-fill { height: 100%; border-radius: 2px; }
.conf-text { font-size: 0.68rem; color: var(--text-muted); }

.chevron-icon {
  width: 16px; height: 16px;
  color: var(--text-muted);
  transition: transform 0.2s;
}
.finding-unified-row[open] .chevron-icon { transform: rotate(180deg); }

.finding-expanded {
  padding: 20px 24px;
  position: relative;
  z-index: 1;
}

.finding-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 16px;
}

.finding-section { margin-bottom: 16px; }
.finding-section:last-child { margin-bottom: 0; }

.section-tag {
  font-size: 0.64rem;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.section-hash { color: var(--accent); font-weight: 700; }

.section-content {
  font-size: 0.8rem;
  line-height: 1.7;
  color: var(--text-secondary);
}
.section-content p { margin-bottom: 8px; }
.section-content strong { color: var(--text-primary); }
.section-content code {
  background: var(--bg-elevated);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.76rem;
  border: 1px solid var(--grid-line);
}
.section-content ul { margin: 6px 0; padding-left: 16px; }
.section-content li { margin-bottom: 3px; }

.no-findings {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  font-size: 0.8rem;
}

/* ── Remediation Steps ── */
.step {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
  padding: 16px 18px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  border-left: 3px solid var(--accent);
  animation: fadeInStep 0.4s ease backwards;
}

.step-num {
  font-size: 0.68rem;
  color: var(--accent);
  font-weight: 700;
  letter-spacing: 0.04em;
  padding-top: 2px;
  flex-shrink: 0;
}

.step-content { flex: 1; }

.step-action {
  font-weight: 600;
  font-size: 0.82rem;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.step-meta { display: flex; flex-direction: column; gap: 8px; }

.step-how, .step-impact {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.76rem;
  line-height: 1.6;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 3px;
  flex-shrink: 0;
  margin-top: 2px;
  min-width: 52px;
  text-align: center;
}

.step-badge--how {
  background: rgba(34,211,238,0.15);
  color: var(--accent);
  border: 1px solid rgba(34,211,238,0.25);
}

.step-badge--impact {
  background: rgba(52,211,153,0.15);
  color: var(--green);
  border: 1px solid rgba(52,211,153,0.25);
}

[data-theme="light"] .step-badge--how {
  background: rgba(8,145,178,0.1);
  color: var(--accent);
  border: 1px solid rgba(8,145,178,0.2);
}
[data-theme="light"] .step-badge--impact {
  background: rgba(5,150,105,0.1);
  color: var(--green);
  border: 1px solid rgba(5,150,105,0.2);
}

.step-text { color: var(--text-secondary); }

/* ── Examples ── */
.examples-section { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }

.example-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.example-side {
  padding: 12px 14px;
  border-radius: var(--radius);
  border: 1px solid;
}

.example-bad { background: rgba(255,77,106,0.06); border-color: rgba(255,77,106,0.2); }
.example-good { background: rgba(52,211,153,0.06); border-color: rgba(52,211,153,0.2); }

.example-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.example-bad .example-tag { color: var(--red); }
.example-good .example-tag { color: var(--green); }

.example-side code {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* ── Quick Win ── */
.quickwin-strip {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid;
  border-radius: var(--radius);
  background: var(--bg-surface);
}

.quickwin-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 3px;
  margin-bottom: 8px;
}

.quickwin-text {
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--text-secondary);
}
.quickwin-text code {
  background: var(--bg-elevated);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.74rem;
  border: 1px solid var(--grid-line);
}

/* ── Actions ── */
.fix-suggestions { margin-bottom: 16px; }

.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.action-card {
  background: var(--bg-elevated);
  border: 1px solid var(--grid-line-strong);
  border-radius: var(--radius);
  padding: 18px;
}

.action-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.action-card-header h4 {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.action-intro {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-bottom: 12px;
  line-height: 1.5;
}

.action-status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
}

.action-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.action-list li {
  font-size: 0.76rem;
  line-height: 1.6;
  padding-left: 14px;
  position: relative;
  margin-bottom: 6px;
  white-space: normal;
  overflow: visible;
}
.action-list li::before {
  content: '';
  position: absolute;
  left: 0; top: 8px;
  width: 4px; height: 4px;
  border-radius: 1px;
  background: var(--text-muted);
}

.action-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.action-cmd { font-weight: 600; color: var(--text-primary); }
.action-savings { font-size: 0.68rem; font-weight: 700; margin-left: auto; }
.action-detail { color: var(--text-secondary); line-height: 1.5; display: block; font-size: 0.76rem; }

.action-cli-block {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--grid-line);
}
.action-cli-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.action-cli {
  padding: 14px 16px;
  background: var(--bg-base);
  border: 1px solid var(--grid-line-strong);
  border-radius: var(--radius);
  position: relative;
}
.action-cli--prominent {
  border-color: var(--green);
  box-shadow: 0 0 12px rgba(52,211,153,0.15), inset 0 0 12px rgba(52,211,153,0.05);
  padding: 18px 16px;
}
.action-cli--prominent code {
  font-size: 1rem;
  color: var(--green);
}
.cli-prompt {
  position: absolute;
  top: 12px; left: 16px;
  color: var(--green);
  font-size: 0.82rem;
  font-weight: 700;
}
.action-cli code {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.88rem;
  font-weight: 600;
  padding-left: 20px;
  word-break: break-all;
  color: var(--text-primary);
}
.action-cli-options {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cli-option {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.72rem;
}
.cli-option code {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-primary);
  background: var(--bg-base);
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid var(--grid-line);
  white-space: nowrap;
}
.cli-option span {
  color: var(--text-muted);
  font-size: 0.68rem;
}
.action-cli-steps {
  margin-top: 16px;
  padding: 14px 16px;
  background: var(--bg-base);
  border: 1px solid var(--grid-line);
  border-radius: var(--radius);
}
.cli-step-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.cli-step-title code { font-size: 0.72rem; color: var(--accent); background: none; border: none; padding: 0; }
.cli-steps-list {
  list-style: none;
  counter-reset: step;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cli-steps-list li {
  counter-increment: step;
  font-size: 0.72rem;
  color: var(--text-secondary);
  line-height: 1.5;
  padding-left: 28px;
  position: relative;
}
.cli-steps-list li::before {
  content: counter(step);
  position: absolute;
  left: 0; top: 0;
  width: 20px; height: 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--grid-line-strong);
  border-radius: 50%;
  font-size: 0.58rem;
  font-weight: 700;
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cli-steps-list li code { font-size: 0.68rem; color: var(--text-primary); background: var(--bg-elevated); padding: 1px 4px; border-radius: 2px; border: 1px solid var(--grid-line); }

/* ── Footer ── */
.cmd-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 0;
  border-top: 1px solid var(--grid-line-strong);
  font-size: 0.68rem;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.footer-marker { color: var(--accent); font-weight: 700; }
.footer-sep { opacity: 0.3; }
.footer-blink { color: var(--green); animation: blink-slow 3s ease-in-out infinite; }

@keyframes blink-slow {
  0%, 80%, 100% { opacity: 1; }
  90% { opacity: 0.3; }
}

/* ── Animations ── */
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes fadeInRow {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeInStep {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Responsive ── */
@media (max-width: 700px) {
  .bento-health,
  .bento-sessions,
  .bento-tokens,
  .bento-cache,
  .bento-issues,
  .bento-donut,
  .bento-savings {
    grid-column: 1 / -1;
  }
}

@media (max-width: 900px) {
  .actions-grid { grid-template-columns: 1fr; }
  .example-pair { grid-template-columns: 1fr; }
  .finding-detail-grid { grid-template-columns: 1fr; }
  .findings-thead { display: none; }
  .finding-summary {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .finding-col--summary { display: none; }
  .finding-col--chevron { display: none; }
}

@media (max-width: 600px) {
  .report-container { padding: 0 12px 32px; }
  .cmd-header-top { flex-direction: column; gap: 12px; align-items: flex-start; }
  .cmd-nav { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .metric-val { font-size: 1.4rem; }
  .bar-row { grid-template-columns: 1fr; gap: 4px; }
  .bar-label { text-align: left; }
}

/* ── prefers-reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>`;
}

// ============================================================================
// JavaScript
// ============================================================================

function renderScripts(): string {
  return `<script>
// ── Theme toggle ──
function toggleTheme() {
  var html = document.documentElement;
  var current = html.getAttribute('data-theme');
  var next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('tokenomics-theme', next); } catch(e) {}
}

(function() {
  try {
    var saved = localStorage.getItem('tokenomics-theme');
    if (saved) { document.documentElement.setAttribute('data-theme', saved); }
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch(e) {}
})();

// ── Sticky nav highlighting ──
(function() {
  var links = document.querySelectorAll('.cmd-nav-link');
  var sections = ['overview','findings','actions'].map(function(id) { return document.getElementById(id); }).filter(Boolean);

  function updateNav() {
    var current = '';
    for (var i = 0; i < sections.length; i++) {
      var rect = sections[i].getBoundingClientRect();
      if (rect.top <= 120) current = sections[i].id;
    }
    links.forEach(function(link) {
      link.classList.toggle('active', link.getAttribute('data-section') === current);
    });
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();
})();

// ── JS-powered tooltips ──
(function() {
  var tip = document.createElement('div');
  tip.className = 'tooltip-popup';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[data-tooltip]');
    if (!el) return;
    tip.textContent = el.getAttribute('data-tooltip');
    tip.classList.add('visible');

    var rect = el.getBoundingClientRect();
    var tipW = tip.offsetWidth;
    var tipH = tip.offsetHeight;
    var left = rect.left + rect.width / 2 - tipW / 2;
    var top = rect.top - tipH - 12;

    if (left < 8) left = 8;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    if (top < 8) { top = rect.bottom + 12; }

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });

  document.addEventListener('mouseout', function(e) {
    var el = e.target.closest('[data-tooltip]');
    if (el) { tip.classList.remove('visible'); }
  });
})();

// ── Bar fill animation on scroll ──
(function() {
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.bar-fill').forEach(function(bar) {
          var w = bar.style.width;
          bar.style.width = '0%';
          requestAnimationFrame(function() {
            requestAnimationFrame(function() { bar.style.width = w; });
          });
        });
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });

  document.querySelectorAll('.savings-bars').forEach(function(el) { observer.observe(el); });
})();
</script>`;
}

// ============================================================================
// Main Export
// ============================================================================

export function renderHtmlReport(output: AnalysisOutput): string {
  const { metadata, findings } = output;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tokenomics Report &mdash; ${new Date(metadata.generatedAt).toLocaleDateString()}</title>
  ${renderStyles()}
</head>
<body>
  <div class="report-container">
    ${renderHeader(metadata)}
    ${renderDashboard(metadata, findings)}
    ${renderUnifiedFindings(findings)}
    ${renderFixSuggestions(findings)}
    ${renderFooter(metadata)}
  </div>
  ${renderScripts()}
</body>
</html>`;
}
