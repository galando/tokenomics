/**
 * Token Estimation Utilities
 *
 * Provides rough token estimation for agents that don't report
 * native token counts.
 *
 * Estimation is based on the heuristic of ~4 characters per token,
 * which is a reasonable approximation for English text and code.
 */

/**
 * Estimate token count from text length
 *
 * Uses a simple heuristic: ~4 characters per token
 * This is approximate - actual tokenization varies by model and content
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Remove whitespace for more accurate estimation
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  // Rough estimate: ~4 characters per token
  // This works reasonably well for English text and code
  return Math.ceil(trimmed.length / 4);
}

/**
 * Estimate tokens for an array of messages
 */
export function estimateMessageTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
}

/**
 * Estimate token count for a tool use
 */
export function estimateToolUseTokens(toolUse: { input: Record<string, unknown> }): number {
  const inputStr = JSON.stringify(toolUse.input);
  return estimateTokens(inputStr);
}

/**
 * Estimate token count for a tool result
 */
export function estimateToolResultTokens(result: { content: string }): number {
  return estimateTokens(result.content);
}

/**
 * Calculate estimated session totals
 */
export interface EstimatedSessionTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function estimateSessionTokens(
  messages: Array<{ role: string; content: string }>,
  toolUses?: Array<{ input: Record<string, unknown> }>,
  toolResults?: Array<{ content: string }>
): EstimatedSessionTokens {
  let inputTokens = 0;
  let outputTokens = 0;

  // Estimate message tokens
  for (const msg of messages) {
    const tokens = estimateTokens(msg.content);
    if (msg.role === 'user') {
      inputTokens += tokens;
    } else {
      outputTokens += tokens;
    }
  }

  // Estimate tool use tokens (count as input)
  if (toolUses) {
    for (const tool of toolUses) {
      inputTokens += estimateToolUseTokens(tool);
    }
  }

  // Estimate tool result tokens (count as input)
  if (toolResults) {
    for (const result of toolResults) {
      inputTokens += estimateToolResultTokens(result);
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Confidence level for estimated tokens
 *
 * Estimates are less reliable than native token counts,
 * so this metadata helps signal data quality to users.
 */
export interface EstimationMetadata {
  /** Whether tokens are estimated or native */
  isEstimated: boolean;
  /** Estimated accuracy (0-1) */
  confidence: number;
  /** Method used for estimation */
  method: 'character-ratio' | 'native';
}

/**
 * Get estimation metadata for a session
 */
export function getEstimationMetadata(hasNativeCounts: boolean): EstimationMetadata {
  if (hasNativeCounts) {
    return {
      isEstimated: false,
      confidence: 1.0,
      method: 'native',
    };
  }

  return {
    isEstimated: true,
    confidence: 0.7, // Character-based estimation is ~70% accurate
    method: 'character-ratio',
  };
}
