/**
 * JSONL Streaming Parser
 *
 * Parses Claude Code session files line by line, handling:
 * - user messages
 * - assistant messages with usage metrics
 * - tool_use and tool_result records
 * - Graceful error handling for malformed lines
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type {
  JsonlRecord,
  SessionData,
  Message,
  ToolUse,
  ToolResult,
  ContextTurn,
} from './types.js';
import type { DiscoveredFile } from './discovery.js';

/**
 * Parse a single JSONL file and return a SessionData object
 */
export async function parseSessionFile(file: DiscoveredFile): Promise<SessionData | null> {
  const records: JsonlRecord[] = [];

  try {
    const rl = createInterface({
      input: createReadStream(file.path, 'utf-8'),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const record = JSON.parse(line) as JsonlRecord;
        records.push(record);
      } catch {
        // Skip malformed JSON lines silently
        // Could log in verbose mode
      }
    }
  } catch (error) {
    // File read error
    return null;
  }

  return buildSessionData(records, file);
}

/**
 * Build SessionData from parsed records
 */
function buildSessionData(records: JsonlRecord[], file: DiscoveredFile): SessionData | null {
  if (records.length === 0) return null;

  const sessionId = records[0]?.sessionId ?? file.sessionId;
  const cwd = records[0]?.cwd ?? '';
  const slug = findSlug(records) ?? file.sessionId.slice(0, 8);

  const messages: Message[] = [];
  const toolUses: ToolUse[] = [];
  const toolResults: ToolResult[] = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let compactCount = 0;

  let startedAt = '';
  let endedAt = '';
  let model = '';

  for (const record of records) {
    // Track timestamps
    if (record.timestamp) {
      if (!startedAt || record.timestamp < startedAt) {
        startedAt = record.timestamp;
      }
      if (!endedAt || record.timestamp > endedAt) {
        endedAt = record.timestamp;
      }
    }

    // Process by record type
    if (record.type === 'user' && record.message) {
      const msg = record.message;

      // Check for tool_result
      if (msg.type === 'tool_result' || (msg.content && typeof msg.content !== 'string')) {
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (typeof item === 'object' && item !== null && 'tool_use_id' in item) {
              toolResults.push({
                tool_use_id: (item as { tool_use_id: string }).tool_use_id,
                content:
                  typeof (item as { content: string }).content === 'string'
                    ? (item as { content: string }).content
                    : JSON.stringify((item as { content: unknown }).content),
                is_error: (item as { is_error?: boolean }).is_error ?? false,
                timestamp: record.timestamp ?? '',
              });
            }
          }
        }
      }

      // Regular user message
      const contentStr = extractContentString(msg.content);
      if (contentStr) {
        messages.push({
          role: 'user',
          content: contentStr,
          timestamp: record.timestamp ?? '',
        });
      }
    }

    if (record.type === 'assistant' && record.message) {
      const msg = record.message;

      // Track model
      if (msg.model && !model) {
        model = msg.model;
      }

      // Extract usage metrics
      if (msg.usage) {
        totalInputTokens += msg.usage.input_tokens ?? 0;
        totalOutputTokens += msg.usage.output_tokens ?? 0;
        totalCacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
        totalCacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
      }

      // Extract tool uses and text content
      const content = msg.content;
      if (Array.isArray(content)) {
        let textContent = '';
        for (const item of content) {
          if (typeof item === 'object' && item !== null) {
            if (item.type === 'tool_use') {
              toolUses.push({
                id: item.id,
                name: item.name,
                input: item.input,
                timestamp: record.timestamp ?? '',
              });
            } else if (item.type === 'text' && 'text' in item) {
              textContent += item.text;
            }
          }
        }
        if (textContent.trim()) {
          messages.push({
            role: 'assistant',
            content: textContent.trim(),
            usage: msg.usage
              ? {
                  inputTokens: msg.usage.input_tokens ?? 0,
                  outputTokens: msg.usage.output_tokens ?? 0,
                  cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
                  cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
                }
              : undefined,
            timestamp: record.timestamp ?? '',
          });
        }
      } else if (typeof content === 'string' && content.trim()) {
        messages.push({
          role: 'assistant',
          content: content.trim(),
          usage: msg.usage
            ? {
                inputTokens: msg.usage.input_tokens ?? 0,
                outputTokens: msg.usage.output_tokens ?? 0,
                cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
                cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
              }
            : undefined,
          timestamp: record.timestamp ?? '',
        });
      }
    }
  }

  // Detect /compact usage from tool uses
  for (const tu of toolUses) {
    if (tu.name === 'compact' || (tu.name === 'Bash' && compactCount === 0)) {
      // Check Bash commands for compact
      if (tu.name === 'Bash') {
        const cmd = tu.input.command ?? tu.input.cmd;
        if (typeof cmd === 'string' && cmd.includes('compact')) {
          compactCount++;
        }
      } else {
        compactCount++;
      }
    }
  }

  // Calculate turn count from messages
  const turnCount = messages.filter((m) => m.role === 'user').length;

  return {
    id: sessionId,
    agent: 'claude-code', // Will be overridden by adapter
    rawTokenCounts: true, // Claude Code reports actual token counts
    project: extractProjectName(cwd),
    projectPath: cwd,
    slug,
    model: model || 'unknown',
    messages,
    toolUses,
    toolResults,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    turnCount,
    compactUsed: compactCount > 0,
    compactCount,
    startedAt,
    endedAt,
    sourceFile: file.path,
  };
}

/**
 * Find the session slug from records
 */
function findSlug(records: JsonlRecord[]): string | null {
  for (const record of records) {
    if (record.slug) return record.slug;
  }
  return null;
}

/**
 * Extract string content from message content
 */
function extractContentString(content: string | unknown[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (item): item is { type: 'text'; text: string } =>
          typeof item === 'object' && item !== null && (item as { type: string }).type === 'text'
      )
      .map((item) => item.text)
      .join('\n');
  }
  return '';
}

/**
 * Extract project name from cwd path
 */
function extractProjectName(cwd: string): string {
  if (!cwd) return 'unknown';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
}

/**
 * Get context turns for snowball analysis
 */
export function getContextTurns(session: SessionData): ContextTurn[] {
  const turns: ContextTurn[] = [];

  for (const msg of session.messages) {
    if (msg.usage) {
      turns.push({
        turnIndex: turns.length,
        inputTokens: msg.usage.inputTokens,
        outputTokens: msg.usage.outputTokens,
        cacheReadTokens: msg.usage.cacheReadTokens,
        cacheCreationTokens: msg.usage.cacheCreationTokens,
        totalContext:
          msg.usage.inputTokens +
          msg.usage.cacheReadTokens +
          Math.floor(msg.usage.cacheCreationTokens / 2), // Cache creation is amortized
        role: msg.role,
        timestamp: msg.timestamp,
      });
    }
  }

  return turns;
}

/**
 * Parse multiple session files
 */
export async function parseSessionFiles(files: DiscoveredFile[]): Promise<SessionData[]> {
  const sessions: SessionData[] = [];

  for (const file of files) {
    const session = await parseSessionFile(file);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}
