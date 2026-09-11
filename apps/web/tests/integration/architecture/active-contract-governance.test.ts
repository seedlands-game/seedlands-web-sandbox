import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const toRepositoryPath = (path: string) => relative(root, path).split(sep).join('/');
type Registry = {
  schemaVersion: number;
  owners: Array<{
    id: string;
    paths: string[];
    contracts: Array<{ id: string; files: string[] }>;
  }>;
};
const registry = JSON.parse(readFileSync(resolve(root, 'harness/contracts.json'), 'utf8')) as Registry;
const dependencyGraphModule = (await import(
  new URL('../../../../../scripts/harness/dependency-graph.mjs', import.meta.url).href
)) as unknown as {
  ownersFor(path: string, registry: Registry): string[];
  pathMatches(path: string, pattern: string): boolean;
};
const impactPlanModule = (await import(
  new URL('../../../../../scripts/harness/impact-plan.mjs', import.meta.url).href
)) as unknown as {
  validateRegistry(registry: Registry): void;
};
const { ownersFor, pathMatches } = dependencyGraphModule;
const { validateRegistry } = impactPlanModule;

const ignoredDirectories = new Set(['.svelte-kit', 'coverage', 'dist', 'node_modules']);
const workspaceRoots = [
  'packages/kernel',
  'packages/stdlib',
  'packages/cognition-protocol',
  'packages/eslint-plugin',
  'apps/web',
  'apps/agent-server',
  'playbooks/classic',
];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [toRepositoryPath(path)];
  });
}

const workspaceFiles = workspaceRoots.flatMap((directory) => walk(resolve(root, directory)));
const isActiveOwnedFile = (path: string) =>
  /\/(?:benchmarks|public|scenarios|scripts|src|tests)\//.test(`/${path}`) ||
  basename(path) === 'package.json' ||
  /\/(?:tsconfig(?:\.[^/]*)?\.json|vitest\.config\.ts)$/.test(path);
const activeOwnedFiles = workspaceFiles.filter(isActiveOwnedFile);

const syntheticHistoryFixtures = new Set([
  'apps/web/tests/integration/engineering/change-archive.test.ts',
  'apps/web/tests/integration/engineering/ci-change-scope.test.ts',
  'apps/web/tests/integration/engineering/harness-impact-plan.test.ts',
  'packages/eslint-plugin/tests/module-size-eslint.test.ts',
]);

function executableHistoryReferences(path: string): string[] {
  if (syntheticHistoryFixtures.has(path) || path.endsWith('/scenarios/canonical-runtime-v1.json')) return [];
  if (!/\.(?:[cm]?[jt]sx?|svelte)$/.test(path)) return [];

  const contents = readFileSync(resolve(root, path), 'utf8');
  const script = path.endsWith('.svelte')
    ? [...contents.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
    : contents;
  const source = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true);
  const references: string[] = [];
  const ioCalls = new Set([
    'access',
    'accessSync',
    'createReadStream',
    'exec',
    'execFile',
    'open',
    'openSync',
    'readFile',
    'readFileSync',
    'spawn',
    'stat',
    'statSync',
  ]);

  const hasHistoryLiteral = (node: ts.Node) => {
    let found = false;
    const inspect = (candidate: ts.Node) => {
      if (ts.isStringLiteralLike(candidate) && /(?:^|\/)changes\//.test(candidate.text)) found = true;
      if (!found) ts.forEachChild(candidate, inspect);
    };
    inspect(node);
    return found;
  };
  const record = (node: ts.Node) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    references.push(`${path}:${position.line + 1}`);
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      /(?:^|\/)changes\//.test(node.moduleSpecifier.text)
    ) {
      record(node);
    } else if (ts.isCallExpression(node)) {
      const callName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? 'import'
            : '';
      if ((callName === 'import' || callName === 'require' || ioCalls.has(callName)) && hasHistoryLiteral(node)) {
        record(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

describe('active ownership and dependency governance', () => {
  it('keeps tests with their owners and ESLint outside the game test projects', () => {
    expect(existsSync(resolve(root, 'tests'))).toBe(false);
    expect(readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')).not.toContain('packages/eslint-plugin');
    const manifest = JSON.parse(readFileSync(resolve(root, 'packages/eslint-plugin/package.json'), 'utf8')) as {
      scripts: { test: string };
    };
    expect(manifest.scripts.test).toBe('vitest run --config vitest.config.ts');
    expect(existsSync(resolve(root, 'packages/eslint-plugin/vitest.config.ts'))).toBe(true);
  });
  it('runs the package boundary rule over the current production sources', async () => {
    const eslint = new ESLint({ cwd: root });
    const reports = await eslint.lintFiles([
      'packages/kernel/src',
      'packages/stdlib/src',
      'packages/cognition-protocol/src',
      'playbooks/classic/src',
      'apps/web/src',
      'apps/agent-server/src',
    ]);
    const violations = reports.flatMap((report) =>
      report.messages
        .filter((message) => message.ruleId === 'seedlands/package-boundary')
        .map((message) => `${toRepositoryPath(report.filePath)}:${message.line}:${message.message}`),
    );

    expect(violations).toEqual([]);
  }, 30_000);

  it('assigns every active source, test, asset and package config to a registered owner', () => {
    validateRegistry(registry);

    expect(activeOwnedFiles.filter((path) => ownersFor(path, registry).length === 0)).toEqual([]);
    for (const owner of registry.owners) {
      for (const contract of owner.contracts) {
        for (const pattern of contract.files) {
          expect(
            activeOwnedFiles.some((path) => pathMatches(path, pattern)),
            `${owner.id}/${contract.id} has no active file matching ${pattern}`,
          ).toBe(true);
        }
      }
    }
  });

  it('does not import or read archived change files from active code and tests', () => {
    expect([...activeOwnedFiles, ...walk(resolve(root, 'scripts'))].flatMap(executableHistoryReferences)).toEqual([]);

    const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const executableConfiguration = [
      ...Object.entries(rootManifest.scripts ?? {}).map(([name, command]) => `package.json#${name}: ${command}`),
      readFileSync(resolve(root, 'playwright.config.ts'), 'utf8'),
      readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
    ];
    expect(executableConfiguration.filter((value) => /changes\/[^\s'"`]+\/(?:e2e|examples)\//.test(value))).toEqual([]);
  });
});
