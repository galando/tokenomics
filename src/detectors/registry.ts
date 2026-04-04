import type { SessionData, DetectorResult, Detector, AgentContext } from '../types.js';
import { buildAgentContext } from './agent-context.js';
import { validateDetectorResults, type ValidationConfig } from './validation.js';
import { detectContextSnowball } from './context-snowball.js';
import { detectModelSelection } from './model-selection.js';
import { detectFileReadWaste } from './file-read-waste.js';
import { detectBashOutputBloat } from './bash-output-bloat.js';
import { detectVaguePrompts } from './vague-prompts.js';
import { detectSessionTiming } from './session-timing.js';
import { detectSubagentOpportunity } from './subagent-opportunity.js';
import { detectClaudeMdOverhead } from './claude-md-overhead.js';
import { detectMcpToolTax } from './mcp-tool-tax.js';
import { detectBestPractices } from './best-practices.js';

const detectors: Detector[] = [
  { name: 'context-snowball', detect: detectContextSnowball, minConfidence: 0.5 },
  { name: 'model-selection', detect: detectModelSelection, minConfidence: 0.5 },
  { name: 'file-read-waste', detect: detectFileReadWaste, minConfidence: 0.4 },
  { name: 'bash-output-bloat', detect: detectBashOutputBloat, minConfidence: 0.4 },
  { name: 'vague-prompts', detect: detectVaguePrompts, minConfidence: 0.5 },
  { name: 'session-timing', detect: detectSessionTiming, minConfidence: 0.3 },
  { name: 'subagent-opportunity', detect: detectSubagentOpportunity, minConfidence: 0.5, supportedAgents: ['claude-code'] },
  { name: 'best-practices', detect: detectBestPractices, minConfidence: 0.6 },
];

const asyncDetectors = [
  { name: 'claude-md-overhead', detect: detectClaudeMdOverhead, minConfidence: 0.4 },
  { name: 'mcp-tool-tax', detect: detectMcpToolTax, minConfidence: 0.5, supportedAgents: ['claude-code', 'cursor'] },
];

export async function runAllDetectors(
  sessions: SessionData[],
  agentContext?: AgentContext,
  validationConfig?: ValidationConfig
): Promise<DetectorResult[]> {
  const findings: DetectorResult[] = [];

  // Build agent context from sessions if not provided
  const context = agentContext ?? buildAgentContext(sessions);

  for (const detector of detectors) {
    try {
      // Check if detector supports the agents in context
      if (context.agentIds.length > 0 && detector.supportedAgents) {
        const hasSupportedAgent = context.agentIds.some((agentId) =>
          detector.supportedAgents?.includes(agentId)
        );
        if (!hasSupportedAgent) continue;
      }

      const result = await detector.detect(sessions, context);
      if (result && result.confidence >= (detector.minConfidence ?? 0.3)) {
        findings.push(result);
      }
    } catch (error) {
      console.error(`Detector ${detector.name} failed:`, error);
    }
  }

  // Apply validation layer
  const validated = validateDetectorResults(findings, sessions, detectors, validationConfig);

  validated.sort((a, b) => b.savingsTokens - a.savingsTokens);

  return validated;
}

export async function runAsyncDetectors(
  sessions: SessionData[],
  agentContext?: AgentContext,
  validationConfig?: ValidationConfig
): Promise<DetectorResult[]> {
  const findings: DetectorResult[] = [];

  // Build agent context from sessions if not provided
  const context = agentContext ?? buildAgentContext(sessions);

  for (const detector of asyncDetectors) {
    try {
      // Check if detector supports the agents in context
      if (context.agentIds.length > 0 && detector.supportedAgents) {
        const hasSupportedAgent = context.agentIds.some((agentId) =>
          detector.supportedAgents?.includes(agentId)
        );
        if (!hasSupportedAgent) continue;
      }

      const result = await detector.detect(sessions, context);
      if (result && result.confidence >= (detector.minConfidence ?? 0.3)) {
        findings.push(result);
      }
    } catch (error) {
      console.error(`Async detector ${detector.name} failed:`, error);
    }
  }

  // Apply validation layer
  const validated = validateDetectorResults(findings, sessions, asyncDetectors, validationConfig);

  validated.sort((a, b) => b.savingsTokens - a.savingsTokens);
  return validated;
}

export function registerDetector(detector: Detector): void {
  detectors.push(detector);
}

export function getDetectorNames(): string[] {
  return detectors.map((d) => d.name);
}
