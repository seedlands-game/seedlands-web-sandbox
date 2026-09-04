import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readProjectFile = (path: string) => readFileSync(join(root, path), 'utf8');
const projectFiles = (path: string): string[] =>
  readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(path, entry.name);
    return entry.isDirectory() ? projectFiles(relativePath) : [relativePath];
  });

describe('SDD and testing governance', () => {
  it('defines the baseline and requirement E2E lifecycle', () => {
    const agents = readProjectFile('AGENTS.md');

    expect(agents).toContain('### 基线 E2E 与需求 E2E');
    expect(agents).toContain('Active');
    expect(agents).toContain('Delivered');
    expect(agents).toContain('Archived');
    expect(agents).toContain('高智能模型独立评审');
    expect(agents).toContain('Sol/xhigh');
    expect(agents).toContain('fail closed');
  });

  it('defines non-substitutable Vitest, Playwright, and Midscene evidence', () => {
    const agents = readProjectFile('AGENTS.md');

    expect(agents).toContain('### Vitest、Playwright 与 Midscene 证据边界');
    expect(agents).toContain('N/A');
  });

  it('requires spec and test cases before implementation', () => {
    const agents = readProjectFile('AGENTS.md');

    expect(agents).toContain('### Spec-first 与 TDD 门禁');
    expect(agents).not.toContain('实现、测试和准出，再在同一交付中补齐短 spec');
    expect(agents).not.toContain('实现后测试是必需门槛');
  });

  it('defines Agile, Breaking, and isolated Exploration flows', () => {
    const agents = readProjectFile('AGENTS.md');

    expect(agents).toContain('### 三种 SDD 流程');
    expect(agents).toContain('Agile flow');
    expect(agents).toContain('Breaking flow');
    expect(agents).toContain('Exploration flow');
    expect(agents).toContain('SHA-256');
    expect(agents).toContain('/tmp');
    expect(agents).toContain('不自动授权');
  });

  it('keeps the default E2E command bounded to the baseline directory', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['test:e2e']).toBe('playwright test tests/e2e');
  });

  it('discovers both baseline and change-local Playwright cases from one config', () => {
    const config = readProjectFile('playwright.config.ts');

    expect(config).toContain("testDir: '.'");
    expect(config).toContain("'tests/e2e/**/*.spec.ts'");
    expect(config).toContain("'changes/*/e2e/**/*.spec.ts'");
  });

  it('keeps Harness on baseline E2E and type-checks change-local cases', () => {
    const harnessRunner = readProjectFile('scripts/run-playwright-harness.mjs');
    const testTypeScript = JSON.parse(readProjectFile('tsconfig.test.json')) as { include?: string[] };

    expect(harnessRunner).toContain("['exec', 'playwright', 'test', 'tests/e2e']");
    expect(testTypeScript.include).toContain('changes/*/e2e');
  });

  it('allows kebab-case Playwright files under a change e2e directory', () => {
    const pathRules = readProjectFile('.ls-lint.yml');

    expect(pathRules).toContain('changes/*/e2e:');
    expect(pathRules).toContain('.spec.ts: kebab-case');
  });

  it('keeps the visual-upgrade requirement case only with its change', () => {
    const expectedPath = 'changes/2026-09-04-visual-upgrade/e2e/visual-upgrade.spec.ts';
    const candidateRoots = ['tests/e2e', 'changes'].filter((path) => existsSync(join(root, path)));
    const matchingSuites = candidateRoots
      .flatMap(projectFiles)
      .filter((path) => path.endsWith('.spec.ts'))
      .filter((path) => readProjectFile(path).includes('Seedlands visual upgrade'));

    expect(matchingSuites).toEqual([expectedPath]);
    expect(readProjectFile(expectedPath)).toContain("from '../../../tests/e2e/support/harness'");
  });
});
