/**
 * Test helpers for Tokenomics
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const FIXTURES_DIR = join(__dirname, 'fixtures');

/**
 * Get path to a fixture file
 */
export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}
