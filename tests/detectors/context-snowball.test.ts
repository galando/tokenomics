/**
 * Tests for Context Snowball Detector
 */

import { describe, it, expect } from 'vitest';
import { detectContextSnowball } from '../../src/detectors/context-snowball.js';
import { parseSessionFile } from '../../src/parser.js';
import type { DiscoveredFile } from '../../src/discovery.js';
import { fixturePath } from '../helpers.js';

describe('Context Snowball Detector', () => {
  it('detects snowball in fixture', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('context-snowball-session.jsonl'),
      projectPath: '/Users/test/snowball-project',
      projectName: 'snowball-project',
      sessionId: 'snowball-test-001',
      modifiedAt: new Date('2026-03-27'),
      size: 5000,
    };

    const session = await parseSessionFile(file);
    expect(session).not.toBeNull();

    const result = detectContextSnowball([session!]);

    expect(result).not.toBeNull();
    expect(result?.detector).toBe('context-snowball');
    expect(result?.severity).toBe('high');
    expect(result?.evidence.sessionsWithSnowball).toBe(1);
    expect(result?.evidence.avgGrowthMultiplier).toBeGreaterThan(2);
  });

  it('returns null for empty sessions', () => {
    const result = detectContextSnowball([]);
    expect(result).toBeNull();
  });

  it('calculates correct snowball rate', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('context-snowball-session.jsonl'),
      projectPath: '/Users/test/snowball-project',
      projectName: 'snowball-project',
      sessionId: 'snowball-test-001',
      modifiedAt: new Date('2026-03-27'),
      size: 5000,
    };

    const snowballSession = await parseSessionFile(file);
    expect(snowballSession).not.toBeNull();

    // Create a non-snowball session (simple, short - no context growth)
    const simpleSession: SessionData = {
      id: 'simple-session',
      slug: 'simple-session',
      project: 'simple-project',
      projectPath: '/simple',
      model: 'claude-sonnet-4-6',
      messages: [],
      toolUses: [],
      toolResults: [],
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      turnCount: 1,
      compactUsed: false,
      compactCount: 0,
      startedAt: '2026-03-27T10:00:00.000Z',
      endedAt: '2026-03-27T10:01:00.000Z',
      sourceFile: '/simple/session.jsonl',
    };

    const result = detectContextSnowball([snowballSession!, simpleSession]);

    expect(result).not.toBeNull();
    expect(result?.evidence.totalSessions).toBe(2);
    expect(result?.evidence.sessionsWithSnowball).toBe(1);
    expect(result?.evidence.snowballRate).toBe(50);
  });

  it('identifies worst sessions correctly', async () => {
    const file: DiscoveredFile = {
      path: fixturePath('context-snowball-session.jsonl'),
      projectPath: '/Users/test/snowball-project',
      projectName: 'snowball-project',
      sessionId: 'snowball-test-001',
      modifiedAt: new Date('2026-03-27'),
      size: 5000,
    };

    const session = await parseSessionFile(file);
    expect(session).not.toBeNull();

    const result = detectContextSnowball([session!]);

    expect(result).not.toBeNull();
    expect(result?.evidence.worstSessions).toBeInstanceOf(Array);
    expect(result?.evidence.worstSessions.length).toBeGreaterThan(0);

    const worst = result?.evidence.worstSessions[0] as {
      slug: string;
      growthMultiplier: number;
    };
    expect(worst.slug).toBe('snowball-session');
    expect(worst.growthMultiplier).toBeGreaterThan(2);
  });
});
