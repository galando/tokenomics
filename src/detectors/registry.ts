import type { SessionData, DetectorResult, Detector } from '../types.js';
import { detectContextSnowball } from './context-snowball.js';
import { detectModelSelection } from './model-selection.js';
import { detectFileReadWaste } from './file-read-waste.js';
import { detectBashOutputBloat } from './bash-output-bloat.js';
import { detectVaguePrompts } from './vague-prompts.js';
import { detectSessionTiming } from './session-timing.js';
import { detectSubagentOpportunity } from './subagent-opportunity.js';
import { detectClaudeMdOverhead } from './claude-md-overhead.js';
import { detectMcpToolTax } from './mcp-tool-tax.js';

const detectors: Detector[] = [
  { name: 'context-snowball', detect: detectContextSnowball },
  { name: 'model-selection', detect: detectModelSelection },
  { name: 'file-read-waste', detect: detectFileReadWaste },
  { name: 'bash-output-bloat', detect: detectBashOutputBloat },
  { name: 'vague-prompts', detect: detectVaguePrompts },
  { name: 'session-timing', detect: detectSessionTiming },
  { name: 'subagent-opportunity', detect: detectSubagentOpportunity },
];

const asyncDetectors = [
  { name: 'claude-md-overhead', detect: detectClaudeMdOverhead },
  { name: 'mcp-tool-tax', detect: detectMcpToolTax },
];

export function runAllDetectors(sessions: SessionData[]): DetectorResult[] {
  const findings: DetectorResult[] = [];

  for (const detector of detectors) {
    try {
      const result = detector.detect(sessions);
      if (result && result.confidence > 0.3) {
        findings.push(result);
      }
    } catch (error) {
      console.error(`Detector ${detector.name} failed:`, error);
    }
  }

  findings.sort((a, b) => b.savingsTokens - a.savingsTokens);

  return findings;
}

export async function runAsyncDetectors(sessions: SessionData[]): Promise<DetectorResult[]> {
  const findings: DetectorResult[] = [];

  for (const detector of asyncDetectors) {
    try {
      const result = await detector.detect(sessions);
      if (result && result.confidence > 0.3) {
        findings.push(result);
      }
    } catch (error) {
      console.error(`Async detector ${detector.name} failed:`, error);
    }
  }

  findings.sort((a, b) => b.savingsTokens - a.savingsTokens);
  return findings;
}

export function registerDetector(detector: Detector): void {
  detectors.push(detector);
}

export function getDetectorNames(): string[] {
  return detectors.map((d) => d.name);
}
