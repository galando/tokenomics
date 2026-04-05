/**
 * Detector Validation Layer
 *
 * Post-detection filter that prevents false positives by:
 * - Verifying findings match supported agents
 * - Checking evidence references exist
 * - Dropping low-confidence marginal findings with estimated data
 */

import type { DetectorResult, SessionData, Detector } from '../types.js';
import { hasNativeTokenCounts } from './agent-context.js';

export interface ValidationConfig {
  /** Minimum confidence threshold (0-1) */
  minConfidence: number;
  /** Whether to drop findings with estimated tokens */
  dropEstimated: boolean;
  /** Whether to validate evidence references */
  validateEvidence: boolean;
}

/**
 * Default validation config
 */
const DEFAULT_CONFIG: ValidationConfig = {
  minConfidence: 0.4,
  dropEstimated: false, // Don't drop by default, just reduce confidence
  validateEvidence: true,
};

/**
 * Validate a single detector result
 */
export function validateDetectorResult(
  result: DetectorResult,
  sessions: SessionData[],
  detector: Detector,
  config: ValidationConfig = DEFAULT_CONFIG
): boolean {
  // Check confidence threshold
  if (result.confidence < config.minConfidence) {
    return false;
  }

  // Check if detector supports the agents in the sessions
  if (detector.supportedAgents && detector.supportedAgents.length > 0) {
    const sessionAgents = Array.from(new Set(sessions.map((s) => s.agent)));
    const hasSupportedAgent = sessionAgents.some((agentId) =>
      detector.supportedAgents?.includes(agentId)
    );

    if (!hasSupportedAgent) {
      return false;
    }
  }

  // For marginal findings with estimated tokens, drop if below higher threshold
  if (config.dropEstimated) {
    const hasEstimates = sessions.some((s) => !hasNativeTokenCounts(s));
    if (hasEstimates && result.confidence < 0.6) {
      return false;
    }
  }

  // Validate evidence references (if enabled)
  if (config.validateEvidence && result.evidence) {
    if (!validateEvidence(result.evidence, sessions)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate evidence references
 */
function validateEvidence(evidence: unknown, sessions: SessionData[]): boolean {
  // Basic validation: check that evidence has expected structure
  if (typeof evidence !== 'object' || evidence === null) {
    return false;
  }

  // If evidence has session slugs, verify they exist in our sessions
  const evidenceRecord = evidence as Record<string, unknown>;

  if (Array.isArray(evidenceRecord.examples)) {
    const sessionSlugs = new Set(sessions.map((s) => s.slug));

    for (const example of evidenceRecord.examples) {
      if (typeof example === 'object' && example !== null) {
        const ex = example as Record<string, unknown>;
        if (ex.slug && typeof ex.slug === 'string') {
          if (!sessionSlugs.has(ex.slug)) {
            return false; // Invalid session reference
          }
        }
      }
    }
  }

  return true;
}

/**
 * Filter detector results through validation layer
 */
export function validateDetectorResults(
  results: DetectorResult[],
  sessions: SessionData[],
  detectors: Detector[],
  config: ValidationConfig = DEFAULT_CONFIG
): DetectorResult[] {
  const validated: DetectorResult[] = [];

  for (const result of results) {
    const detector = detectors.find((d) => d.name === result.detector);
    if (!detector) continue; // Unknown detector, skip

    if (validateDetectorResult(result, sessions, detector, config)) {
      validated.push(result);
    }
  }

  return validated;
}

/**
 * Create a validation config for a specific agent
 */
export function createAgentValidationConfig(
  _agentId: string,
  baseConfig: ValidationConfig = DEFAULT_CONFIG
): ValidationConfig {
  return {
    ...baseConfig,
    // Agent-specific validation can be added here
  };
}

/**
 * Validate and filter results for multi-agent scenarios
 */
export function validateMultiAgentResults(
  results: DetectorResult[],
  sessions: SessionData[],
  detectors: Detector[],
  config: ValidationConfig = DEFAULT_CONFIG
): DetectorResult[] {
  // Group results by agent
  const resultsByAgent = new Map<string, DetectorResult[]>();

  for (const result of results) {
    // Extract agent from evidence if available
    const agentId = extractAgentFromResult(result, sessions);
    if (!agentId) continue;

    const existing = resultsByAgent.get(agentId) ?? [];
    existing.push(result);
    resultsByAgent.set(agentId, existing);
  }

  // Validate each agent's results separately
  const validated: DetectorResult[] = [];

  for (const [agentId, agentResults] of resultsByAgent.entries()) {
    const agentSessions = sessions.filter((s) => s.agent === agentId);
    const agentConfig = createAgentValidationConfig(agentId, config);

    const agentValidated = validateDetectorResults(
      agentResults,
      agentSessions,
      detectors,
      agentConfig
    );

    validated.push(...agentValidated);
  }

  return validated;
}

/**
 * Extract agent ID from a detector result
 */
function extractAgentFromResult(result: DetectorResult, sessions: SessionData[]): string | null {
  // Try to extract from evidence
  if (result.evidence && typeof result.evidence === 'object') {
    const evidence = result.evidence as Record<string, unknown>;

    // Check for agentViolations (from best-practices detector)
    if (Array.isArray(evidence.agentViolations) && evidence.agentViolations.length > 0) {
      const firstViolation = evidence.agentViolations[0] as Record<string, unknown>;
      if (firstViolation.agentId && typeof firstViolation.agentId === 'string') {
        return firstViolation.agentId;
      }
    }

    // Check for examples with session data
    if (Array.isArray(evidence.examples) && evidence.examples.length > 0) {
      const firstExample = evidence.examples[0] as Record<string, unknown>;
      if (firstExample.slug && typeof firstExample.slug === 'string') {
        // Find the session and get its agent
        const session = sessions.find((s) => s.slug === firstExample.slug);
        if (session) {
          return session.agent;
        }
      }
    }
  }

  // Fallback: use the first session's agent
  if (sessions.length > 0) {
    return sessions[0]!.agent;
  }

  return null;
}

/**
 * Calculate validation statistics
 */
export interface ValidationStats {
  totalResults: number;
  validatedResults: number;
  filteredResults: number;
  filterReasons: Record<string, number>;
}

export function calculateValidationStats(
  originalResults: DetectorResult[],
  validatedResults: DetectorResult[],
  detectors: Detector[]
): ValidationStats {
  const filterReasons: Record<string, number> = {
    'low-confidence': 0,
    'unsupported-agent': 0,
    'estimated-tokens': 0,
    'invalid-evidence': 0,
  };

  const validatedIds = new Set(validatedResults.map((r) => `${r.detector}-${r.confidence}`));

  for (const result of originalResults) {
    if (validatedIds.has(`${result.detector}-${result.confidence}`)) {
      continue;
    }

    // Determine filter reason
    if (result.confidence < DEFAULT_CONFIG.minConfidence) {
      filterReasons['low-confidence'] = (filterReasons['low-confidence'] ?? 0) + 1;
    } else {
      const detector = detectors.find((d) => d.name === result.detector);
      if (detector?.supportedAgents && detector.supportedAgents.length > 0) {
        filterReasons['unsupported-agent'] = (filterReasons['unsupported-agent'] ?? 0) + 1;
      } else {
        filterReasons['estimated-tokens'] = (filterReasons['estimated-tokens'] ?? 0) + 1;
      }
    }
  }

  return {
    totalResults: originalResults.length,
    validatedResults: validatedResults.length,
    filteredResults: originalResults.length - validatedResults.length,
    filterReasons,
  };
}
