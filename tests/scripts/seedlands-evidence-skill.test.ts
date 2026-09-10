import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const skill = join(root, '.agents/skills/seedlands-evidence');

// These are runnable aliases; the remaining scripts are their local dependencies.
const entrypoints = ['run-playwright-harness.mjs', 'run-harness.mjs', 'with-benchmark-reservation.mjs'];
const references = ['ci-testing.md', 'development-governance.md', 'performance-execution.md', 'context-engineering.md'];

describe('seedlands-evidence package resources', () => {
  it('resolves advertised resources through relocatable links inside this checkout', () => {
    const navigation = [...readFileSync(join(skill, 'SKILL.md'), 'utf8').matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)]
      .map((match) => match[1]!)
      .filter((target) => !/^https?:/.test(target));
    for (const resource of [
      ...navigation,
      ...entrypoints.map((name) => `scripts/${name}`),
      ...references.map((name) => `references/${name}`),
    ]) {
      expect(resource.startsWith('scripts/') || resource.startsWith('references/'), resource).toBe(true);
      const alias = join(skill, resource);
      expect(lstatSync(alias).isSymbolicLink(), resource).toBe(true);
      expect(isAbsolute(readlinkSync(alias)), resource).toBe(false);
      const target = realpathSync(alias);
      expect(target).toBe(join(root, resource.startsWith('scripts/') ? 'scripts' : 'docs', basename(resource)));
      const targetWithinRoot = relative(root, target);
      expect(targetWithinRoot.startsWith('..') || isAbsolute(targetWithinRoot), resource).toBe(false);
      expect(readFileSync(alias).length, resource).toBeGreaterThan(0);
    }
  });

  it('exposes relative script dependencies without duplicating their source', () => {
    for (const name of readdirSync(join(skill, 'scripts'))) {
      const alias = join(skill, 'scripts', name);
      expect(lstatSync(alias).isSymbolicLink(), name).toBe(true);
      const content = readFileSync(alias, 'utf8');
      for (const match of content.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) {
        const dependency = resolve(dirname(alias), match[1]!);
        expect(realpathSync(dependency)).toBe(resolve(dirname(realpathSync(alias)), match[1]!));
      }
    }
  });

  it('runs the linked reservation entry and preserves the child exit code', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'seedlands-skill-link-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          join(skill, 'scripts/with-benchmark-reservation.mjs'),
          '--lock-dir',
          join(temporary, 'reservation'),
          '--wait-timeout-ms',
          '1000',
          '--',
          process.execPath,
          '-e',
          'process.stdout.write("skill-child-executed"); process.exitCode = 7;',
        ],
        { cwd: temporary, encoding: 'utf8', timeout: 10_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.stdout).toBe('skill-child-executed');
      expect(result.status).toBe(7);
      expect(readdirSync(temporary)).toEqual([]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
