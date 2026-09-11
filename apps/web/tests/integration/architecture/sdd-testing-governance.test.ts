import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const packageJson = () => JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

describe('SDD and testing governance', () => {
  it('keeps the reviewed change lifecycle and non-substitutable evidence levels', () => {
    const agents = read('AGENTS.md');
    const governance = read('docs/development-governance.md');

    expect(agents).toContain('changes/YYYY-MM-DD-kebab-name/spec.md');
    expect(agents).toContain('docs/development-governance.md');
    expect(governance).toContain('## E2E 生命周期');
    expect(governance).toContain('Active');
    expect(governance).toContain('Delivered');
    expect(governance).toContain('Archived');
    expect(governance).toContain('## 证据边界');
    expect(governance).toContain('N/A');
    expect(governance).toContain('Sol/xhigh');
    expect(governance).toContain('fail closed');
    expect(governance).toContain('Agile');
    expect(governance).toContain('Breaking');
    expect(governance).toContain('Exploration');
    expect(governance).toContain('SHA-256');
    expect(governance).toContain('高智能模型独立评审');
    expect(governance).toContain('先建立');
    expect(governance).not.toContain('实现、测试和准出，再在同一交付中补齐短 spec');
    expect(governance).not.toContain('实现后测试是必需门槛');
    expect(governance).toContain('/tmp');
    expect(governance).toContain('不自动授权');
  });

  it('gives Kernel, stdlib, Classic and ESLint their own test entry and Vitest config', () => {
    for (const owner of ['packages/kernel', 'packages/stdlib', 'playbooks/classic', 'packages/eslint-plugin']) {
      const manifest = JSON.parse(read(`${owner}/package.json`)) as { scripts?: Record<string, string> };
      expect(manifest.scripts?.test, owner).toContain('vitest');
      expect(manifest.scripts?.test, owner).toContain('vitest.config.ts');
      expect(existsSync(resolve(root, owner, 'vitest.config.ts')), owner).toBe(true);
    }
  });

  it('uses one canonical Classic Playwright spec and rejects a second active route', () => {
    const config = read('playwright.config.ts');
    const specRoot = resolve(root, 'apps/web/tests/e2e');
    const activeSpecs = readdirSync(specRoot, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('.spec.ts'));

    expect(activeSpecs).toEqual(['classic-runtime.spec.ts']);
    expect(config).toContain("testMatch: ['apps/web/tests/e2e/classic-runtime.spec.ts']");
    expect(config).not.toContain('changes/*/e2e');
  });

  it('routes tests, affected verification and Classic through the Harness runner', () => {
    const scripts = packageJson().scripts ?? {};

    expect(scripts.test).toBe('node scripts/harness/run.mjs --stage tests');
    expect(scripts['harness:plan']).toBe('node scripts/harness/plan.mjs');
    expect(scripts['verify:affected']).toBe('node scripts/harness/run.mjs --stage affected');
    expect(scripts['verify:all']).toBe('node scripts/harness/run.mjs --stage all');
    expect(scripts['harness:classic']).toBe('node scripts/harness/run.mjs --stage classic');
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(/playwright test|changes\/[^ ]+\/e2e/);
    }
  });

  it('uses the trusted base planner and makes bootstrap full-new explicit', () => {
    const ci = read('.github/workflows/ci.yml');

    expect(ci).toContain('git cat-file -e "$BASE_SHA:scripts/harness/plan.mjs"');
    expect(ci).toContain('git archive "$BASE_SHA" scripts/harness');
    expect(ci).toContain('--root "$GITHUB_WORKSPACE" --base "$BASE_SHA" --head "$HEAD_SHA"');
    expect(ci).toContain('--all --out "$HARNESS_PLAN_PATH"');
    expect(ci).toContain('missing-base-selector');
    expect(ci).toContain('pnpm verify:affected --plan');
  });

  it('builds once and runs the canonical route against the downloaded byte-identical artifact', () => {
    const ci = read('.github/workflows/ci.yml');

    expect(ci.match(/run: pnpm build$/gm)).toHaveLength(1);
    expect(ci).toContain('path: apps/web/dist');
    expect(ci).toContain('apps/web/dist/harness-artifact.json');
    expect(ci).toContain('actions/download-artifact@');
    expect(ci.match(/run: pnpm harness:classic$/gm)).toHaveLength(1);
    expect(ci).not.toContain('run: pnpm build:web');
    expect(ci).not.toContain('run: pnpm test:e2e');
  });

  it('documents owner selection, artifact identity and fail-closed evidence', () => {
    const ciTesting = read('docs/ci-testing.md');
    const contracts = read('docs/harness-contracts.md');
    const skill = read('.agents/skills/seedlands-evidence/SKILL.md');

    for (const term of ['baseSha', 'headSha', 'full-new', 'documentationOnly', 'No effective tests selected'])
      expect(`${ciTesting}\n${contracts}`).toContain(term);
    for (const term of ['sourceSha', 'sourceDigest', 'lockDigest', 'artifactDigest']) expect(contracts).toContain(term);
    expect(skill).toContain('scripts/plan.mjs');
    expect(skill).toContain('scripts/run.mjs');
    expect(skill).toContain('scripts/artifact.mjs');
    expect(skill).toContain('references/harness-contracts.md');
  });
});
