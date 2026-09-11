import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyChangedPaths,
  parseNulSeparatedPaths,
  selectCiScope,
} from '../../../../../scripts/ci-change-scope.mjs';

const heavyJobCount = (paths: string[]) => (classifyChangedPaths(paths).runFull ? 3 : 0);

describe('CI change scope', () => {
  it('selects the lightweight path for explicit documentation locations', () => {
    const paths = [
      'README.md',
      'docs/code-map.md',
      'changes/2026-09-08-example/spec.md',
      '.agents/skills/example/SKILL.md',
      'docs/diagrams/runtime.svg',
      'changes/2026-09-08-example/evidence/screenshot.webp',
    ];

    expect(classifyChangedPaths(paths)).toEqual({ runFull: false, reason: 'docs-only' });
    expect(heavyJobCount(paths)).toBe(0);
  });

  it('keeps production assets and executable change or skill files on full CI', () => {
    for (const path of [
      'apps/web/public/hero.webp',
      'changes/2026-09-08-example/e2e/example.spec.ts',
      'changes/2026-09-08-example/experiments/probe.rs',
      '.agents/skills/example/scripts/check.mjs',
    ]) {
      expect(classifyChangedPaths([path])).toEqual({ runFull: true, reason: 'non-documentation' });
    }
  });

  it('keeps source, tests, dependencies, workflows, configs, and unknown paths on full CI', () => {
    for (const path of [
      'AGENTS.md',
      'docs/development-governance.md',
      'apps/web/src/main.ts',
      'tests/client/release-build.test.ts',
      'package.json',
      'pnpm-lock.yaml',
      '.github/workflows/ci.yml',
      'docs/generated/report.json',
      'unclassified.data',
    ]) {
      expect(classifyChangedPaths([path])).toEqual({ runFull: true, reason: 'non-documentation' });
    }
  });

  it('fails closed for mixed changes and an empty diff', () => {
    expect(heavyJobCount(['docs/code-map.md', 'packages/game-core/src/world/world.ts'])).toBe(3);
    expect(classifyChangedPaths([])).toEqual({ runFull: true, reason: 'no-changes' });
  });

  it('always selects full CI for main pushes and unsupported events', () => {
    expect(selectCiScope('push', ['README.md'])).toEqual({ runFull: true, reason: 'main-push' });
    expect(selectCiScope('workflow_dispatch', ['README.md'])).toEqual({
      runFull: true,
      reason: 'unsupported-event',
    });
  });

  it('parses NUL-delimited paths without treating spaces or newlines as separators', () => {
    expect(parseNulSeparatedPaths(Buffer.from('docs/with space.md\0changes/example/line\nbreak.md\0'))).toEqual([
      'docs/with space.md',
      'changes/example/line\nbreak.md',
    ]);
    expect(() => parseNulSeparatedPaths(Buffer.from('docs/not-terminated.md'))).toThrow(/NUL-terminated/);
  });

  it('prints only fixed GitHub output scalars', () => {
    const script = join(process.cwd(), 'scripts/ci-change-scope.mjs');
    const result = spawnSync(process.execPath, [script, '--event', 'pull_request'], {
      input: Buffer.from('docs/with space.md\0changes/example/line\nbreak.md\0'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('run_full=false\nreason=docs-only\n');
  });

  it('fails closed when CLI input is malformed', () => {
    const script = join(process.cwd(), 'scripts/ci-change-scope.mjs');
    const result = spawnSync(process.execPath, [script, '--event', 'pull_request'], {
      input: Buffer.from('docs/not-terminated.md'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('run_full=true\nreason=invalid-input\n');
  });

  it('keeps the visible CI steps equivalent to the complete static command', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const scripts = (
      JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const staticJob = workflow.split('  static:\n')[1]?.split('\n  build:')[0];
    expect(staticJob).toBeDefined();
    expect(scripts['verify:static:ci']).toBe('pnpm verify:affected');
    expect(staticJob).toContain('pnpm verify:affected --plan');
    // The runner independently reconstructs base/head requirements from Git objects.
    expect(staticJob).toMatch(/with:\s+fetch-depth: 0\s+ref: \$\{\{ needs\.scope\.outputs\.head_sha \}\}/);
    expect(staticJob).toContain('Harness scope selection failed');
    expect(staticJob).not.toContain("if: needs.scope.outputs.run_full == 'true'");
  });

  it('executes the protected base revision classifier for pull requests', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('git cat-file -e "$BASE_SHA:scripts/harness/plan.mjs"');
    expect(workflow).toContain('git archive "$BASE_SHA" scripts/harness');
    expect(workflow).toContain('node "$TRUSTED_POLICY_ROOT/scripts/harness/plan.mjs"');
    expect(workflow).toContain("plan.mode !== 'full-new'");
    expect(workflow).toContain('missing-base-selector');
    expect(workflow).toContain('--all --out "$HARNESS_PLAN_PATH"');
  });
});
