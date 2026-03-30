/**
 * Tests for JSONL Parser
 */

import { describe, it, expect } from 'vitest';
import { parseSessionFile } from '../src/parser.js';
import type { DiscoveredFile } from '../src/discovery.js';
import { fixturePath } from './helpers.js';

describe('JSONL Parser', () => {
  it('parses a simple session file', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('simple-session.jsonl'),
      projectPath: '/Users/test/myproject',
      projectName: 'myproject',
      sessionId: 'test-session-001',
      modifiedAt: new Date('2026-03-27'),
      size: 1000,
    };

    const session = await parseSessionFile(file);

    expect(session).not.toBeNull();
    expect(session?.id).toBe('test-session-001');
    expect(session?.slug).toBe('test-session-slug');
    expect(session?.model).toBe('claude-sonnet-4-6');
    expect(session?.project).toBe('myproject');
  });

  it('extracts messages correctly', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('simple-session.jsonl'),
      projectPath: '/Users/test/myproject',
      projectName: 'myproject',
      sessionId: 'test-session-001',
      modifiedAt: new Date('2026-03-27'),
      size: 1000,
    };

    const session = await parseSessionFile(file);

    expect(session?.messages.length).toBeGreaterThan(0);

    const userMessages = session?.messages.filter((m) => m.role === 'user') ?? [];
    expect(userMessages.length).toBeGreaterThan(0);

    const assistantMessages = session?.messages.filter((m) => m.role === 'assistant') ?? [];
    expect(assistantMessages.length).toBeGreaterThan(0);
  });

  it('extracts tool uses', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('simple-session.jsonl'),
      projectPath: '/Users/test/myproject',
      projectName: 'myproject',
      sessionId: 'test-session-001',
      modifiedAt: new Date('2026-03-27'),
      size: 1000,
    };

    const session = await parseSessionFile(file);

    expect(session?.toolUses.length).toBeGreaterThan(0);
    expect(session?.toolUses[0]?.name).toBe('Read');
    expect(session?.toolUses[0]?.id).toBe('tool-001');
  });

  it('aggregates token usage', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('simple-session.jsonl'),
      projectPath: '/Users/test/myproject',
      projectName: 'myproject',
      sessionId: 'test-session-001',
      modifiedAt: new Date('2026-03-27'),
      size: 1000,
    };

    const session = await parseSessionFile(file);

    expect(session?.totalInputTokens).toBe(250); // 100 + 150
    expect(session?.totalOutputTokens).toBe(80); // 50 + 30
    expect(session?.totalCacheReadTokens).toBe(100);
    expect(session?.totalCacheCreationTokens).toBe(200);
  });

  it('handles missing file gracefully', async () => {
    const file: DiscoveredFile = {
      path: '/nonexistent/file.jsonl',
      projectPath: '/nonexistent',
      projectName: 'test',
      sessionId: 'test-id',
      modifiedAt: new Date(),
      size: 0,
    };

    const session = await parseSessionFile(file);
    expect(session).toBeNull();
  });
});
