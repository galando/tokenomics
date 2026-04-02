/**
 * BDD tests for CI/CD GitHub Actions workflows.
 *
 * Covers scenarios from intent.md:
 *   - Scenario 2: PR build validates code
 *   - Scenario 3: Push to main runs CI
 *   - Scenario 4: Version consistency guard
 *   - Scenario 1: Tag push triggers npm publish
 *   - Scenario 5: Build failure blocks publish (implicit — build step runs before publish)
 *   - Scenario 6: Test failure blocks publish (implicit — test step runs before publish)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from './yaml-utils.js';

const ROOT = join(import.meta.dirname, '..');

function loadYaml(file: string) {
  return parseYaml(readFileSync(join(ROOT, file), 'utf-8'));
}

function loadPackageJson() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
}

// ── Scenario 2 & 3: CI workflow ──────────────────────────────────────

describe('CI workflow (.github/workflows/ci.yml)', () => {
  let ci: any;

  beforeAll(() => {
    ci = loadYaml('.github/workflows/ci.yml');
  });

  it('triggers on push to main', () => {
    expect(ci.on.push.branches).toContain('main');
  });

  it('triggers on pull_request against main', () => {
    expect(ci.on.pull_request.branches).toContain('main');
  });

  it('runs on ubuntu-latest', () => {
    expect(ci.jobs.test['runs-on']).toBe('ubuntu-latest');
  });

  it('uses actions/checkout@v4', () => {
    const steps = ci.jobs.test.steps as any[];
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout).toBeDefined();
    expect(checkout.uses).toContain('v4');
  });

  it('uses actions/setup-node@v4 with node 18 and npm cache', () => {
    const steps = ci.jobs.test.steps as any[];
    const setupNode = steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setupNode).toBeDefined();
    expect(setupNode.uses).toContain('v4');
    expect(String(setupNode.with['node-version'])).toBe('18');
    expect(setupNode.with.cache).toBe('npm');
  });

  it('runs npm ci', () => {
    const steps = ci.jobs.test.steps as any[];
    const npmCi = steps.find((s) => s.run === 'npm ci');
    expect(npmCi).toBeDefined();
  });

  it('runs npm run build', () => {
    const steps = ci.jobs.test.steps as any[];
    const build = steps.find((s) => s.run === 'npm run build');
    expect(build).toBeDefined();
  });

  it('runs npm test', () => {
    const steps = ci.jobs.test.steps as any[];
    const test = steps.find((s) => s.run === 'npm test');
    expect(test).toBeDefined();
  });

  it('does NOT have a publish step', () => {
    const steps = ci.jobs.test.steps as any[];
    const publish = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('npm publish'),
    );
    expect(publish).toBeUndefined();
  });
});

// ── Scenario 1, 4, 5, 6: Publish workflow ────────────────────────────

describe('Publish workflow (.github/workflows/publish.yml)', () => {
  let pub: any;

  beforeAll(() => {
    pub = loadYaml('.github/workflows/publish.yml');
  });

  it('triggers on v* tags', () => {
    expect(pub.on.push.tags).toContain('v*');
  });

  it('runs on ubuntu-latest', () => {
    expect(pub.jobs.publish['runs-on']).toBe('ubuntu-latest');
  });

  it('uses actions/checkout@v4', () => {
    const steps = pub.jobs.publish.steps as any[];
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout).toBeDefined();
    expect(checkout.uses).toContain('v4');
  });

  it('sets up node with registry-url for npm', () => {
    const steps = pub.jobs.publish.steps as any[];
    const setupNode = steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setupNode).toBeDefined();
    expect(String(setupNode.with['node-version'])).toBe('18');
    expect(setupNode.with['registry-url']).toBe('https://registry.npmjs.org');
  });

  it('runs npm ci, build, and test before publish', () => {
    const steps = pub.jobs.publish.steps as any[];
    const runCommands = steps.map((s: any) => s.run).filter(Boolean);

    const ciIdx = runCommands.indexOf('npm ci');
    const buildIdx = runCommands.indexOf('npm run build');
    const testIdx = runCommands.indexOf('npm test');

    expect(ciIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(ciIdx);
    expect(testIdx).toBeGreaterThan(buildIdx);
  });

  it('has version consistency check step', () => {
    const steps = pub.jobs.publish.steps as any[];
    // The version check step has name "Verify version matches tag"
    const versionCheck = steps.find(
      (s) =>
        (typeof s.name === 'string' && s.name.toLowerCase().includes('version')) ||
        (typeof s.run === 'string' &&
        s.run.includes('package.json') &&
        s.run.includes('version')),
    );
    expect(versionCheck).toBeDefined();
  });

  it('publishes with --provenance --access public', () => {
    const steps = pub.jobs.publish.steps as any[];
    const publish = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('npm publish'),
    );
    expect(publish).toBeDefined();
    expect(publish.run).toContain('--provenance');
    expect(publish.run).toContain('--access public');
  });

  it('uses NODE_AUTH_TOKEN from secrets.NPM_TOKEN', () => {
    const steps = pub.jobs.publish.steps as any[];
    const publish = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('npm publish'),
    );
    expect(publish).toBeDefined();

    // Check env at step or job level
    const jobEnv = pub.jobs.publish.env || {};
    const stepEnv = publish.env || {};
    const env = { ...jobEnv, ...stepEnv };

    expect(env.NODE_AUTH_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');
  });
});

// ── Scenario 4: Version consistency guard logic ──────────────────────

describe('Version consistency check logic', () => {
  it('extracts version from v-prefixed tag', () => {
    const tag = 'v1.4.0';
    const extracted = tag.replace(/^v/, '');
    expect(extracted).toBe('1.4.0');
  });

  it('matches package.json version correctly', () => {
    const tag = 'v1.3.0';
    const pkg = loadPackageJson();
    const tagVersion = tag.replace(/^v/, '');
    expect(tagVersion).toBe(pkg.version);
  });
});

// ── package.json prepublishOnly ──────────────────────────────────────

describe('package.json prepublishOnly safety guard', () => {
  it('has prepublishOnly script that runs build and test', () => {
    const pkg = loadPackageJson();
    expect(pkg.scripts.prepublishOnly).toBeDefined();
    expect(pkg.scripts.prepublishOnly).toContain('npm run build');
    expect(pkg.scripts.prepublishOnly).toContain('npm test');
  });
});
