# Adapter Development Guide

This guide explains how to create a new agent adapter for Tokenomics.

## Overview

Tokenomics supports multiple AI coding agents through a pluggable adapter system. Each adapter handles:
- **Discovery**: Finding session files for the agent
- **Parsing**: Converting session files to normalized `SessionData`
- **Best Practices**: Agent-specific optimization recommendations
- **Tool Mapping**: Translating agent-specific tool names to universal concepts

## AgentAdapter Interface

```typescript
interface AgentAdapter {
  /** Unique agent identifier (e.g., 'claude-code', 'cursor') */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Agent capabilities and features */
  capabilities: AgentCapabilities;

  /** Detect whether this agent is installed on the system */
  detect(): Promise<boolean>;

  /** Discover session files for this agent */
  discover(options: DiscoveryOptions): Promise<DiscoveredFile[]>;

  /** Parse a single session file into normalized SessionData */
  parse(file: DiscoveredFile): Promise<SessionData | null>;

  /** Get configuration file paths for this agent */
  getConfigPaths(): Promise<string[]>;

  /** Get agent-specific best practices */
  getBestPractices(): BestPractice[];

  /** Map agent-specific tool names to universal concepts */
  getToolMapping(): Record<string, string>;
}
```

## Creating a New Adapter

### Step 1: Create the Adapter File

Create a new file in `src/agents/` (e.g., `src/agents/my-agent.ts`):

```typescript
/**
 * MyAgent Adapter
 *
 * Implements AgentAdapter for MyAgent AI coding assistant.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentAdapter,
  DiscoveredFile,
  DiscoveryOptions,
  BestPractice,
} from './types.js';
import { estimateSessionTokens } from './token-estimation.js';
import type { SessionData } from '../types.js';

export const myAgentAdapter: AgentAdapter = {
  id: 'my-agent',
  name: 'MyAgent',
  capabilities: {
    hasNativeTokenCounts: false, // Adjust based on your agent
    hasModelInfo: true,
    hasToolUsage: true,
    hasTimingData: true,
    configFormat: 'json',
  },

  async detect(): Promise<boolean> {
    const home = homedir();
    try {
      const agentDir = join(home, '.my-agent');
      await stat(agentDir);
      return true;
    } catch {
      return false;
    }
  },

  async discover(options: DiscoveryOptions): Promise<DiscoveredFile[]> {
    // Implement discovery logic
    // Return array of DiscoveredFile objects
    return [];
  },

  async parse(file: DiscoveredFile): Promise<SessionData | null> {
    // Implement parsing logic
    // Return normalized SessionData or null if parsing fails
    return null;
  },

  async getConfigPaths(): Promise<string[]> {
    // Return paths to config files for this agent
    return [];
  },

  getBestPractices(): BestPractice[] {
    return [
      {
        id: 'my-best-practice',
        title: 'Use MyAgent Feature X',
        description: 'Description of the best practice',
        category: 'performance',
        severity: 'medium',
      },
    ];
  },

  getToolMapping(): Record<string, string> {
    return {
      'my_agent_tool': 'universal-tool-name',
    };
  },
};
```

### Step 2: Register the Adapter

Add your adapter to the registry in `src/agents/registry.ts`:

```typescript
import { myAgentAdapter } from './my-agent.js';

export function initializeDefaultAdapters(): void {
  if (adapters.size === 0) {
    registerAdapter(claudeCodeAdapter);
    registerAdapter(cursorAdapter);
    registerAdapter(copilotAdapter);
    registerAdapter(codexAdapter);
    registerAdapter(myAgentAdapter); // Add your adapter here
  }
}
```

### Step 3: Implement Discovery

The `discover()` method should find session files for your agent. Return an array of `DiscoveredFile` objects:

```typescript
async discover(options: DiscoveryOptions): Promise<DiscoveredFile[]> {
  const home = homedir();
  const agentDir = join(home, '.my-agent');
  const cutoffDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const files: DiscoveredFile[] = [];

  try {
    const sessionsDir = join(agentDir, 'sessions');
    const entries = await readdir(sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const filePath = join(sessionsDir, entry.name);
      const stats = await stat(filePath);

      if (stats.mtime < cutoffDate) continue;

      files.push({
        path: filePath,
        agent: 'my-agent',
        projectPath: '', // Extract from file content if available
        projectName: '', // Extract from file content if available
        sessionId: basename(entry.name, '.json'),
        modifiedAt: stats.mtime,
        size: stats.size,
        metadata: {
          source: 'my-agent-sessions',
        },
      });
    }
  } catch (error) {
    // Silently ignore if directory doesn't exist
  }

  return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
```

### Step 4: Implement Parsing

The `parse()` method converts a session file into normalized `SessionData`:

```typescript
async parse(file: DiscoveredFile): Promise<SessionData | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(file.path, 'utf-8');
    const session = JSON.parse(content) as MyAgentSession;

    return this.buildSessionData(session, file);
  } catch {
    return null;
  }
}

buildSessionData(
  session: MyAgentSession,
  file: DiscoveredFile
): SessionData | null {
  const messages: Array<{ role: string; content: string }> = [];
  const toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    timestamp: string;
  }> = [];

  // Extract messages and tool uses from session
  for (const msg of session.messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    } else if (msg.type === 'tool_use') {
      toolUses.push({
        id: msg.id,
        name: msg.name,
        input: msg.input,
        timestamp: msg.timestamp,
      });
    }
  }

  // Estimate tokens if your agent doesn't report them natively
  const estimates = estimateSessionTokens(messages, toolUses, []);

  return {
    id: session.id,
    agent: 'my-agent',
    rawTokenCounts: false, // Set to true if your agent reports actual tokens
    project: session.projectName || 'unknown',
    projectPath: session.projectPath || '',
    slug: session.id.slice(0, 8),
    model: session.model || 'unknown',
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: session.createdAt,
    })),
    toolUses,
    toolResults: [],
    totalInputTokens: estimates.inputTokens,
    totalOutputTokens: estimates.outputTokens,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    turnCount: messages.filter((m) => m.role === 'user').length,
    compactUsed: false,
    compactCount: 0,
    startedAt: session.createdAt,
    endedAt: session.endedAt,
    sourceFile: file.path,
  };
}
```

### Step 5: Define Best Practices

Return agent-specific optimization recommendations:

```typescript
getBestPractices(): BestPractice[] {
  return [
    {
      id: 'use-feature-x',
      title: 'Use Feature X for efficiency',
      description: 'Description of when and how to use this feature',
      category: 'performance',
      severity: 'medium',
      detectFn: (session: SessionData) => {
        // Optional: Return true if this practice is being violated
        return session.toolUses.length > 20;
      },
    },
  ];
}
```

### Step 6: Map Tools to Universal Concepts

Map your agent's tool names to universal concepts for cross-agent analysis:

```typescript
getToolMapping(): Record<string, string> {
  return {
    'read_file': 'read',
    'write_file': 'write',
    'edit_file': 'edit',
    'run_command': 'bash',
    'search_files': 'search',
  };
}
```

## Testing Your Adapter

Create test files in `tests/fixtures/my-agent/` with sample session data, then add tests:

```typescript
// tests/agents/my-agent.test.ts
import { describe, it, expect } from 'vitest';
import { myAgentAdapter } from '../../src/agents/my-agent.js';

describe('MyAgent Adapter', () => {
  it('should detect MyAgent installation', async () => {
    const detected = await myAgentAdapter.detect();
    expect(typeof detected).toBe('boolean');
  });

  it('should parse session files correctly', async () => {
    // Test with fixture data
  });

  it('should produce valid SessionData', async () => {
    // Verify output matches expected structure
  });
});
```

## Token Estimation

If your agent doesn't report native token counts, use the provided estimation utilities:

```typescript
import { estimateSessionTokens, getEstimationMetadata } from './token-estimation.js';

const estimates = estimateSessionTokens(messages, toolUses, toolResults);
const metadata = getEstimationMetadata(false); // false = estimated

// Use estimates.inputTokens and estimates.outputTokens
```

## Universal Tool Concepts

Map your agent's tools to these universal concepts:

- `read`: Reading file contents
- `write`: Creating new files
- `edit`: Modifying existing files
- `bash`: Running shell commands
- `search`: Searching code/files
- `subagent`: Delegating to sub-agents

## Configuration Files

Return paths to configuration files that Tokenomics can optimize:

```typescript
async getConfigPaths(): Promise<string[]> {
  const home = homedir();
  const paths: string[] = [];

  try {
    const configPath = join(home, '.my-agent', 'config.json');
    await stat(configPath);
    paths.push(configPath);
  } catch {
    // File doesn't exist
  }

  return paths;
}
```

## Best Practices

1. **Error Handling**: Always wrap file operations in try-catch and return gracefully
2. **Date Filtering**: Respect the `options.days` parameter to limit discovery scope
3. **Token Accuracy**: Set `rawTokenCounts: true` only if your agent reports actual tokens
4. **Tool Mapping**: Map all tools to universal concepts for better cross-agent analysis
5. **Detection**: Use defensive checks in `detect()` - return `false` if unsure

## Example Adapters

Reference existing adapters for implementation patterns:
- `src/agents/claude-code.ts` - Full implementation with native token counts
- `src/agents/cursor.ts` - Implementation with token estimation
- `src/agents/copilot.ts` - Stub implementation for reference
