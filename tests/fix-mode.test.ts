/**
 * Regression tests for GitHub issue #10
 *
 * Bug: `tokenomics --fix` and `tokenomics --fix --dry-run` crashed with
 *      "Error: Interactive fix not implemented" in interactive terminals.
 *
 * Root cause: The fix code path branched on isInteractive() — TTY sessions
 *      called renderInteractiveFix(), a stub that always threw. The
 *      non-interactive path used renderFixOutput() and worked fine.
 *
 * Fix: Removed the interactive branch; renderFixOutput() is now used for
 *      both TTY and non-TTY sessions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const analyzeSrc = readFileSync(join(import.meta.dirname, '..', 'src', 'analyze.ts'), 'utf-8');

describe('fix mode (issue #10)', () => {
  it('does not contain the "Interactive fix not implemented" error', () => {
    expect(analyzeSrc).not.toContain('Interactive fix not implemented');
  });

  it('does not reference the removed renderInteractiveFix function', () => {
    expect(analyzeSrc).not.toContain('renderInteractiveFix');
  });

  it('does not reference the removed isInteractive function', () => {
    expect(analyzeSrc).not.toContain('isInteractive');
  });

  it('renderFixOutput is still present (the working renderer)', () => {
    expect(analyzeSrc).toContain('function renderFixOutput');
  });

  it('fix mode branch no longer has interactive else-if', () => {
    // The old code had: `} else if (isInteractive()) {`
    // The new code should just have: `} else {`
    expect(analyzeSrc).not.toContain('else if (isInteractive())');
  });
});
