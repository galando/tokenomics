/**
 * MCP Tool Tax Detector
 *
 * Analyzes MCP server usage and identifies rarely-used servers
 * that add overhead to every session.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionData, DetectorResult, Remediation, AgentContext } from '../types.js';
import { adjustConfidenceForEstimates } from './agent-context.js';

interface McpServerUsage {
  name: string;
  sessionsUsed: number;
  totalSessions: number;
  usageRate: number;
  estimatedOverhead: number;
}

interface McpToolTaxEvidence {
  serversAnalyzed: number;
  rarelyUsedServers: McpServerUsage[];
  neverUsedServers: string[];
  totalOverhead: number;
  recommendation: string;
}

const MCP_PREFIXES = ['mcp__', 'plugin_'];

function isMcpTool(toolName: string): boolean {
  return MCP_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

function extractServerName(toolName: string): string | null {
  const parts = toolName.split('__');
  if (parts.length >= 2) {
    return parts[1] ?? null;
  }
  return null;
}

export async function detectMcpToolTax(
  sessions: SessionData[],
  _agentContext?: AgentContext
): Promise<DetectorResult | null> {
  if (sessions.length === 0) return null;

  // This detector only supports Claude Code and Cursor (both support MCP)
  const supportedSessions = sessions.filter((s) =>
    s.agent === 'claude-code' || s.agent === 'cursor'
  );
  if (supportedSessions.length === 0) return null;

  const serverUsage = new Map<string, Set<string>>();

  for (const session of sessions) {
    for (const toolUse of session.toolUses) {
      if (isMcpTool(toolUse.name)) {
        const serverName = extractServerName(toolUse.name);
        if (serverName) {
          if (!serverUsage.has(serverName)) {
            serverUsage.set(serverName, new Set());
          }
          serverUsage.get(serverName)?.add(session.id);
        }
      }
    }
  }

  let configuredServers: string[] = [];
  try {
    const configPath = join(homedir(), '.claude.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    if (config.mcpServers) {
      configuredServers = Object.keys(config.mcpServers);
    }
  } catch {
    // Config doesn't exist
  }

  const serverUsages: McpServerUsage[] = [];

  for (const serverName of configuredServers) {
    const sessionsUsed = serverUsage.get(serverName)?.size ?? 0;
    const usageRate = (sessionsUsed / sessions.length) * 100;
    const estimatedOverhead = Math.round((sessions.length - sessionsUsed) * 200);

    serverUsages.push({
      name: serverName,
      sessionsUsed,
      totalSessions: sessions.length,
      usageRate: Math.round(usageRate),
      estimatedOverhead,
    });
  }

  for (const [serverName, sessionSet] of serverUsage) {
    if (!configuredServers.includes(serverName)) {
      serverUsages.push({
        name: serverName,
        sessionsUsed: sessionSet.size,
        totalSessions: sessions.length,
        usageRate: Math.round((sessionSet.size / sessions.length) * 100),
        estimatedOverhead: 0,
      });
    }
  }

  const rarelyUsedServers = serverUsages
    .filter((s) => s.usageRate > 0 && s.usageRate < 5)
    .sort((a, b) => a.usageRate - b.usageRate);

  const neverUsedServers = serverUsages.filter((s) => s.usageRate === 0).map((s) => s.name);

  if (rarelyUsedServers.length === 0 && neverUsedServers.length === 0) {
    return null;
  }

  const totalOverhead =
    rarelyUsedServers.reduce((sum, s) => sum + s.estimatedOverhead, 0) +
    neverUsedServers.length * supportedSessions.length * 200;

  const totalTokens = supportedSessions.reduce(
    (sum, s) =>
      sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheCreationTokens,
    0
  );
  const savingsPercent =
    totalTokens > 0 ? Math.round((totalOverhead / totalTokens) * 100) : 0;

  const severity: 'high' | 'medium' | 'low' =
    neverUsedServers.length > 3 || savingsPercent > 5
      ? 'high'
      : neverUsedServers.length > 0 || rarelyUsedServers.length > 2
        ? 'medium'
        : 'low';

  let confidence = Math.min(0.9, 0.5 + supportedSessions.length * 0.01);

  // Adjust confidence for estimated tokens
  confidence = adjustConfidenceForEstimates(confidence, sessions);

  const recommendation =
    neverUsedServers.length > 0
      ? `Disable unused servers: ${neverUsedServers.slice(0, 3).join(', ')}`
      : rarelyUsedServers.length > 0
        ? `Consider disabling rarely-used servers: ${rarelyUsedServers
            .slice(0, 3)
            .map((s) => s.name)
            .join(', ')}`
        : 'MCP usage is efficient';

  const remediation = buildMcpToolTaxRemediation(configuredServers, rarelyUsedServers, neverUsedServers, sessions.length);

  return {
    detector: 'mcp-tool-tax',
    title: 'MCP Tool Tax',
    severity,
    savingsPercent,
    savingsTokens: totalOverhead,
    confidence: Math.round(confidence * 100) / 100,
    evidence: {
      serversAnalyzed: configuredServers.length,
      rarelyUsedServers: rarelyUsedServers.slice(0, 5),
      neverUsedServers,
      totalOverhead,
      recommendation,
    } as McpToolTaxEvidence,
    remediation,
    sessionBreakdown: [
      neverUsedServers.length > 0
        ? `**Never used (0/${sessions.length} sessions):** ${neverUsedServers.map((s) => `\`${s}\``).join(', ')}`
        : '',
      rarelyUsedServers.length > 0
        ? `**Rarely used (<5% of sessions):**\n${rarelyUsedServers.slice(0, 5).map((s) =>
            `  - \`${s.name}\`: used in ${s.sessionsUsed}/${s.totalSessions} sessions (${s.usageRate}%)`
          ).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n') || '_MCP usage is efficient._',
  };
}

function buildMcpToolTaxRemediation(
  configuredServers: string[],
  rarelyUsedServers: McpServerUsage[],
  neverUsedServers: string[],
  totalSessions: number,
): Remediation {
  const neverUsedList = neverUsedServers.slice(0, 5).join(', ');
  const rarelyUsedList = rarelyUsedServers.slice(0, 3).map((s) => `${s.name} (${s.usageRate}%)`).join(', ');

  return {
    problem: `MCP (Model Context Protocol) servers are external tool servers that Claude can call during conversations — for example, a database query server or a web scraping server. Each one you have configured adds overhead to every conversation turn, even when unused. You have ${configuredServers.length} MCP servers configured, but ${neverUsedServers.length > 0 ? `${neverUsedServers.length} were never used in any of your ${totalSessions} sessions` : ''}${neverUsedServers.length > 0 && rarelyUsedServers.length > 0 ? ' and ' : ''}${rarelyUsedServers.length > 0 ? `${rarelyUsedServers.length} were used in fewer than 5% of sessions` : ''}. ${neverUsedServers.length > 0 ? `Never-used servers: ${neverUsedList}. ` : ''}${rarelyUsedServers.length > 0 ? `Rarely-used: ${rarelyUsedList}. ` : ''}Every loaded server injects its tool definitions into each API request, whether or not those tools are called. This is a fixed per-turn tax on your token budget.`,

    whyItMatters: `Each MCP server typically adds 100-500 tokens of tool definitions to every API request (tool name, description, parameters, schema). Because every loaded server contributes this overhead on every turn — not just turns where it is used — the cost compounds quickly. With ${configuredServers.length} servers, that's potentially ${configuredServers.length * 300} tokens of overhead on every single turn across every session. Over ${totalSessions} sessions, unused servers consumed ~${Math.round((neverUsedServers.length * totalSessions * 200) / 1000)}K tokens for tools that were never called. Beyond cost, excessive tool definitions can confuse Claude's tool selection — it has to parse and consider tools it will never use, occasionally picking a wrong MCP tool when a built-in tool would be better.`,

    steps: [
      ...(neverUsedServers.length > 0 ? [{
        action: `Disable never-used MCP servers: ${neverUsedServers.slice(0, 3).join(', ')}`,
        howTo: 'Edit your Claude configuration file to remove or comment out the MCP server entries that you\'ve never used. You can always re-enable them later if needed. Run: `claude config` to review your current server configuration.',
        impact: `Removes ~${neverUsedServers.length * 300} tokens of overhead per turn. Over a 20-turn session, that's ${(neverUsedServers.length * 300 * 20).toLocaleString()} tokens saved.`,
      }] : []),
      ...(rarelyUsedServers.length > 0 ? [{
        action: 'Move rarely-used servers to project-level config',
        howTo: `Instead of configuring ${rarelyUsedList} globally, add them only to the specific project that uses them. In that project's directory, create a Claude configuration file with the MCP server entries. This way, the server only loads when you're working in that project, avoiding overhead everywhere else.`,
        impact: 'Eliminates overhead in projects that don\'t use these servers while keeping them available where needed.',
      }] : []),
      {
        action: 'Review MCP servers quarterly',
        howTo: 'Set a reminder to run this analysis monthly. MCP servers tend to accumulate — you install one for a project, finish the project, but leave the server configured. A quarterly cleanup prevents drift.',
        impact: 'Prevents gradual accumulation of unused overhead.',
      },
    ],

    examples: [
      {
        label: 'Removing unused servers',
        before: 'Claude configuration: 8 MCP servers configured → ~2,400 tokens overhead per turn → 48,000 tokens per 20-turn session',
        after: 'Claude configuration: 3 active MCP servers → ~900 tokens overhead per turn → 18,000 tokens per 20-turn session (62% reduction)',
      },
      {
        label: 'Project-level scoping',
        before: 'Global config: database-mcp, figma-mcp, jira-mcp (all loaded in every project)',
        after: 'Global: jira-mcp only. Project A config: database-mcp. Project B config: figma-mcp.',
      },
    ],

    quickWin: neverUsedServers.length > 0
      ? `Open your Claude configuration file and remove "${neverUsedServers[0]}". One server removal saves ~300 tokens per turn across all future sessions.`
      : `Move "${rarelyUsedServers[0]?.name}" to a project-level configuration to stop it loading in every session.`,
    specificQuickWin: (() => {
      if (neverUsedServers.length > 0) {
        const list = neverUsedServers.slice(0, 4).map((s) => `"${s}"`).join(', ');
        return `Never-used MCP servers (0 of ${totalSessions} sessions): ${list}. Remove them from your Claude configuration file — every loaded server adds overhead to every single API call, even when unused, so these provide zero benefit while wasting tokens.`;
      }
      const rare = rarelyUsedServers.slice(0, 3).map((s) => `"${s.name}" (${s.usageRate}% of sessions)`).join(', ');
      return `Rarely-used servers: ${rare}. Move these to a project-level Claude configuration file in the specific project that needs them instead of loading globally.`;
    })(),
    effort: 'moderate',
  };
}
