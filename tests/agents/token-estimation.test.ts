/**
 * Tests for token estimation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateToolUseTokens,
  estimateToolResultTokens,
  estimateSessionTokens,
  getEstimationMetadata,
} from '../../src/agents/token-estimation.js';

describe('Token Estimation', () => {
  describe('estimateTokens()', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('   ')).toBe(0);
    });

    it('should estimate ~4 characters per token', () => {
      const text = 'a'.repeat(1000);
      const tokens = estimateTokens(text);
      expect(tokens).toBe(250);
    });

    it('should handle short text', () => {
      const text = 'Hello world';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should handle code-like text', () => {
      const code = `
        function test() {
          return true;
        }
      `;
      const tokens = estimateTokens(code);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle whitespace correctly', () => {
      const text1 = 'Hello world';
      const text2 = '  Hello  world  ';
      const tokens1 = estimateTokens(text1);
      const tokens2 = estimateTokens(text2);

      // Should be similar (whitespace trimmed)
      expect(Math.abs(tokens1 - tokens2)).toBeLessThan(5);
    });
  });

  describe('estimateMessageTokens()', () => {
    it('should estimate tokens for multiple messages', () => {
      const messages = [
        { content: 'Hello world' },
        { content: 'How are you?' },
        { content: 'Goodbye' },
      ];

      const tokens = estimateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle empty message array', () => {
      const tokens = estimateMessageTokens([]);
      expect(tokens).toBe(0);
    });

    it('should handle messages with empty content', () => {
      const messages = [{ content: '' }, { content: 'Hello' }];
      const tokens = estimateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateToolUseTokens()', () => {
    it('should estimate tokens for tool input', () => {
      const toolUse = {
        input: {
          command: 'ls -la',
          cwd: '/home/user',
        },
      };

      const tokens = estimateToolUseTokens(toolUse);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle empty input', () => {
      const toolUse = { input: {} };
      const tokens = estimateToolUseTokens(toolUse);
      expect(tokens).toBeLessThan(5); // Just '{}'
    });

    it('should handle complex nested input', () => {
      const toolUse = {
        input: {
          files: ['file1.txt', 'file2.txt', 'file3.txt'],
          options: { recursive: true, force: true },
        },
      };

      const tokens = estimateToolUseTokens(toolUse);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateToolResultTokens()', () => {
    it('should estimate tokens for tool result', () => {
      const result = { content: 'File found: 42 items' };
      const tokens = estimateToolResultTokens(result);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle empty result', () => {
      const result = { content: '' };
      const tokens = estimateToolResultTokens(result);
      expect(tokens).toBe(0);
    });
  });

  describe('estimateSessionTokens()', () => {
    it('should estimate full session tokens', () => {
      const messages = [
        { role: 'user', content: 'List files' },
        { role: 'assistant', content: 'Here are the files' },
        { role: 'user', content: 'Thanks' },
      ];
      const toolUses = [{ input: { command: 'ls' } }];
      const toolResults = [{ content: 'file1.txt\nfile2.txt' }];

      const estimates = estimateSessionTokens(messages, toolUses, toolResults);

      expect(estimates.inputTokens).toBeGreaterThan(0);
      expect(estimates.outputTokens).toBeGreaterThan(0);
      expect(estimates.totalTokens).toBe(
        estimates.inputTokens + estimates.outputTokens
      );
    });

    it('should handle session without tools', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const estimates = estimateSessionTokens(messages);

      expect(estimates.inputTokens).toBeGreaterThan(0);
      expect(estimates.outputTokens).toBeGreaterThan(0);
      expect(estimates.totalTokens).toBeGreaterThan(0);
    });

    it('should categorize user messages as input', () => {
      const messages = [{ role: 'user', content: 'User message' }];
      const estimates = estimateSessionTokens(messages);

      expect(estimates.inputTokens).toBeGreaterThan(0);
      expect(estimates.outputTokens).toBe(0);
    });

    it('should categorize assistant messages as output', () => {
      const messages = [{ role: 'assistant', content: 'Assistant message' }];
      const estimates = estimateSessionTokens(messages);

      expect(estimates.inputTokens).toBe(0);
      expect(estimates.outputTokens).toBeGreaterThan(0);
    });
  });

  describe('getEstimationMetadata()', () => {
    it('should return native metadata for actual counts', () => {
      const metadata = getEstimationMetadata(true);

      expect(metadata.isEstimated).toBe(false);
      expect(metadata.confidence).toBe(1.0);
      expect(metadata.method).toBe('native');
    });

    it('should return estimation metadata for estimates', () => {
      const metadata = getEstimationMetadata(false);

      expect(metadata.isEstimated).toBe(true);
      expect(metadata.confidence).toBe(0.7);
      expect(metadata.method).toBe('character-ratio');
    });
  });

  describe('Estimation accuracy', () => {
    it('should be within reasonable bounds for typical text', () => {
      // A typical paragraph
      const text =
        'Token estimation is based on the observation that English text ' +
        'and code typically use about 4 characters per token on average. ' +
        'This varies by content and model, but provides a useful approximation.';

      const tokens = estimateTokens(text);
      const charCount = text.length;

      // Should be close to charCount / 4
      const expected = Math.ceil(charCount / 4);
      const diff = Math.abs(tokens - expected);

      expect(diff).toBeLessThan(5); // Allow small variance
    });
  });
});
