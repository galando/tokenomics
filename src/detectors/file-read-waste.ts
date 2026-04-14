/**
 * File Read Waste Detector
 *
 * Detects inefficient file reading patterns:
 * - Duplicate reads: Same file read multiple times without modification
 * - Unused reads: Files read but never referenced in subsequent edits
 * - Generated file reads: Reading from dist/, node_modules/, etc.
 */

import type { SessionData, DetectorResult, Remediation } from '../types.js';

interface FileReadWasteEvidence {
  sessionsWithWaste: number;
  totalSessions: number;
  wasteRate: number;
  duplicateReads: number;
  unusedReads: number;
  generatedFileReads: number;
  wastedTokens: number;
  topDuplicates: Array<{
    slug: string;
    project: string;
    file: string;
    count: number;
    tokens: number;
    startedAt: string;
    firstPrompt: string;
  }>;
}

const GENERATED_PATTERNS = [
  /\/node_modules\//,
  /\/dist\//,
  /\/build\//,
  /\/.git\//,
  /\/__pycache__\//,
  /\.pyc$/,
  /\.class$/,
];

interface FileReadInfo {
  path: string;
  count: number;
  tokens: number;
  timestamps: string[];
}

function isGeneratedFile(path: string): boolean {
  return GENERATED_PATTERNS.some((p) => p.test(path));
}

export function detectFileReadWaste(sessions: SessionData[]): DetectorResult | null {
  if (sessions.length === 0) return null;

  let totalDuplicateReads = 0;
  let totalUnusedReads = 0;
  let totalGeneratedReads = 0;
  let totalWastedTokens = 0;
  let sessionsWithWaste = 0;

  const allDuplicates: Array<{
    slug: string;
    project: string;
    file: string;
    count: number;
    tokens: number;
    startedAt: string;
    firstPrompt: string;
  }> = [];

  for (const session of sessions) {
    // Track all file reads
    const fileReads = new Map<string, FileReadInfo>();
    let sessionWaste = false;

    // Collect all Read tool uses
    for (const toolUse of session.toolUses) {
      if (toolUse.name === 'Read') {
        const filePath = toolUse.input.file_path as string;
        if (!filePath) continue;

        const existing = fileReads.get(filePath);
        if (existing) {
          existing.count++;
          existing.timestamps.push(toolUse.timestamp);
        } else {
          fileReads.set(filePath, {
            path: filePath,
            count: 1,
            tokens: 0, // We don't have exact token count per file
            timestamps: [toolUse.timestamp],
          });
        }

        // Check for generated file reads
        if (isGeneratedFile(filePath)) {
          totalGeneratedReads++;
          sessionWaste = true;
        }
      }
    }

    // Find duplicate reads
    for (const [path, info] of fileReads) {
      if (info.count > 1) {
        totalDuplicateReads += info.count - 1;
        sessionWaste = true;

        allDuplicates.push({
          slug: session.slug,
          project: session.project,
          file: path.split('/').pop() ?? path,
          count: info.count,
          tokens: Math.round(session.totalInputTokens / session.toolUses.length) * (info.count - 1),
          startedAt: session.startedAt,
          firstPrompt: session.messages.find((m) => m.role === 'user')?.content?.slice(0, 120) ?? '',
        });
      }
    }

    // Check for unused reads (simplified: read but no subsequent Edit/Write)
    const editedFiles = new Set<string>();
    for (const toolUse of session.toolUses) {
      if (toolUse.name === 'Edit' || toolUse.name === 'Write') {
        const filePath = toolUse.input.file_path as string;
        if (filePath) {
          editedFiles.add(filePath);
        }
      }
    }

    for (const [path, info] of fileReads) {
      if (info.count === 1 && !editedFiles.has(path) && !isGeneratedFile(path)) {
        // File was read once but never edited - potentially unused
        // Be conservative: only count if session had no edits at all
        if (editedFiles.size === 0) {
          totalUnusedReads++;
          sessionWaste = true;
        }
      }
    }

    if (sessionWaste) {
      sessionsWithWaste++;
    }
  }

  if (sessionsWithWaste === 0) return null;

  // Calculate wasted tokens (rough estimate)
  const avgInputTokensPerSession = sessions.reduce((sum, s) => sum + s.totalInputTokens, 0) / sessions.length;
  const avgReadsPerSession = sessions.reduce((sum, s) => sum + s.toolUses.filter((t) => t.name === 'Read').length, 0) / sessions.length;

  if (avgReadsPerSession > 0) {
    const tokensPerRead = avgInputTokensPerSession / avgReadsPerSession;
    totalWastedTokens = Math.round(tokensPerRead * (totalDuplicateReads + totalUnusedReads + totalGeneratedReads));
  }

  // Get top duplicates
  const topDuplicates = allDuplicates
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const wasteRate = (sessionsWithWaste / sessions.length) * 100;
  const totalTokens = sessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );
  const savingsPercent = totalTokens > 0 ? Math.round((totalWastedTokens / totalTokens) * 100) : 0;

  const severity: 'high' | 'medium' | 'low' =
    savingsPercent > 10 ? 'high' : savingsPercent > 5 ? 'medium' : 'low';

  const confidence = Math.min(0.85, 0.4 + sessionsWithWaste * 0.02);

  const evidence: FileReadWasteEvidence = {
    sessionsWithWaste,
    totalSessions: sessions.length,
    wasteRate: Math.round(wasteRate),
    duplicateReads: totalDuplicateReads,
    unusedReads: totalUnusedReads,
    generatedFileReads: totalGeneratedReads,
    wastedTokens: totalWastedTokens,
    topDuplicates,
  };

  const remediation = buildFileReadRemediation(evidence);

  // Pre-render session breakdown grouped by project
  const byProject = new Map<string, typeof evidence.topDuplicates>();
  for (const d of evidence.topDuplicates) {
    const list = byProject.get(d.project) ?? [];
    list.push(d);
    byProject.set(d.project, list);
  }
  const sessionBreakdown = [...byProject.entries()]
    .map(([project, dupes]) => {
      const rows = dupes.map((d) =>
        `  - \`${d.file}\` read **${d.count}x** (~${Math.round(d.tokens / 1000)}K tokens wasted)`
      ).join('\n');
      return `**${project}**\n${rows}`;
    }).join('\n\n');

  return {
    detector: 'file-read-waste',
    title: 'File Read Waste',
    severity,
    savingsPercent,
    savingsTokens: totalWastedTokens,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    remediation,
    sessionBreakdown: sessionBreakdown || '_No specific sessions to call out._',
  };
}

function buildFileReadRemediation(evidence: FileReadWasteEvidence): Remediation {
  const formattedTokens = evidence.wastedTokens > 1_000_000
    ? `${(evidence.wastedTokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(evidence.wastedTokens / 1000)}K`;

  // Group duplicates by project
  const byProject = new Map<string, { files: string[]; totalReads: number; worstSlug: string }>();
  for (const d of evidence.topDuplicates) {
    const existing = byProject.get(d.project);
    if (existing) {
      existing.files.push(`\`${d.file}\` (${d.count}×)`);
      existing.totalReads += d.count - 1;
    } else {
      byProject.set(d.project, { files: [`\`${d.file}\` (${d.count}×)`], totalReads: d.count - 1, worstSlug: d.slug });
    }
  }
  const projectLines = [...byProject.entries()]
    .map(([proj, d]) => `**${proj}**: ${d.files.slice(0, 2).join(', ')}`)
    .join('; ');

  const worst = evidence.topDuplicates[0];

  return {
    problem: `Claude re-read the same files ${evidence.duplicateReads} times across ${evidence.sessionsWithWaste} sessions (${evidence.wasteRate}% of total) — without those files being modified in between. ${projectLines ? `By project: ${projectLines}. ` : ''}${evidence.generatedFileReads > 0 ? `Additionally, ${evidence.generatedFileReads} reads hit generated files (node_modules/, dist/, build/). ` : ''}In AI conversations, every Read operation sends the entire file contents into the context window — re-reading a file means injecting the same tokens again for content that is already available from a prior turn.`,

    whyItMatters: `${worst ? `Your single worst case: \`${worst.file}\` read ${worst.count} times in **${worst.project}** — that's ${worst.count - 1} unnecessary reads of the same content. ` : ''}Re-reading a file in an AI conversation is wasteful because the entire file content is injected into the context window each time. Each duplicate read adds ~500–5,000 tokens depending on file size, for zero new information. Total estimated waste: ~${formattedTokens} tokens. In projects like **${worst?.project ?? 'your projects'}**, where the same config or core files get revisited repeatedly across a session, this compounds quickly — each redundant read also raises the context floor for all subsequent turns, making every future response consume more tokens.`,

    steps: [
      {
        action: 'Reference files by name instead of re-reading them',
        howTo: 'After Claude reads a file, refer to it by name in follow-up prompts (e.g., "In the auth.ts file you just read, change the validateToken function"). Claude retains file contents in context and doesn\'t need to re-read unless the file was modified.',
        impact: 'Eliminates the most common source of duplicate reads. Based on your data, this could prevent ~' + Math.round(evidence.duplicateReads * 0.7) + ' redundant reads.',
      },
      {
        action: 'Batch related file reads in a single prompt',
        howTo: 'Instead of asking Claude to "look at the auth module" (which triggers sequential reads), specify all files upfront: "Read src/auth/login.ts, src/auth/jwt.ts, and src/auth/middleware.ts, then explain the auth flow." Claude will read them in parallel and build understanding in one pass.',
        impact: 'Reduces exploration loops where Claude reads files one-by-one, forgets earlier ones, and re-reads them.',
      },
      {
        action: 'Use targeted reads with line ranges for large files',
        howTo: 'For large files, ask Claude to read specific sections: "Read lines 50-120 of database.ts" instead of the entire file. This is especially important for config files, test files, and generated code.',
        impact: 'Reduces per-read token usage by 60-90% for large files, and the smaller payload stays in context more effectively.',
      },
      ...(evidence.generatedFileReads > 0 ? [{
        action: 'Avoid reading generated/vendored files',
        howTo: 'Don\'t ask Claude to read files in node_modules/, dist/, or build/ directories. Instead, reference documentation or type definitions. If you need to understand a dependency, ask Claude to check the package\'s types or README.',
        impact: `Eliminates ${evidence.generatedFileReads} reads of generated files that rarely provide useful context.`,
      }] : []),
      {
        action: 'Create project documentation files to replace exploration reads',
        howTo: 'Write a project documentation file (e.g., ARCHITECTURE.md or a similar overview) that describes your project\'s structure, key directories, naming conventions, and core modules. When you start a new session, point Claude to this file once instead of letting it explore the codebase by reading files one by one. The files that appear most in your duplicate reads are the ones Claude keeps re-reading to re-orient itself — document those upfront.',
        impact: `A concise project overview replaces the re-orientation reads that drive duplicate counts. Your worst offenders (${worst ? `\`${worst.file}\` in **${worst.project}**` : 'your most-read files'}) are prime candidates for being summarized once in documentation rather than re-read on every session.`,
      },
    ],

    examples: [
      {
        label: 'Avoiding duplicate reads',
        before: 'Turn 1: "Read src/auth.ts" → Turn 4: "Read src/auth.ts again to check the function" → Turn 7: "Can you re-read src/auth.ts?"',
        after: 'Turn 1: "Read src/auth.ts" → Turn 4: "In the auth.ts you already read, what does validateToken do?" → Turn 7: "Now modify the validateToken function in auth.ts"',
      },
      {
        label: 'Batched exploration',
        before: '"Look at the auth module" → Claude reads file 1 → reads file 2 → reads file 3 → re-reads file 1 to cross-reference',
        after: '"Read src/auth/login.ts, src/auth/jwt.ts, and src/auth/middleware.ts. Explain how login calls jwt validation and how middleware enforces it."',
      },
    ],

    quickWin: 'In your next session, when you need to reference a file Claude already read, say "in the X file you read earlier" instead of asking it to read again. This prevents the most common duplicate reads.',
    specificQuickWin: (() => {
      const top = evidence.topDuplicates.slice(0, 3);
      if (top.length === 0) return 'When referencing a file Claude already read, say "in the [filename] you read earlier" — no re-read needed.';
      const parts = top.map((d) => `\`${d.file}\` (${d.count}x in **${d.project}**)`);
      return `Your most-duplicated files: ${parts.join('; ')}. When Claude has already read a file, reference it by name instead of triggering a re-read: say "in the \`${top[0]!.file}\` you already read, look at..." — not "read \`${top[0]!.file}\` again".`;
    })(),
    effort: 'quick',
  };
}
