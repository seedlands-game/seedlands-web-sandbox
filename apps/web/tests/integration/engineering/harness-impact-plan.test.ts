import { describe, expect, it } from 'vitest';
import { createImpactPlan, type RepositorySnapshot } from '../../../../../scripts/harness/impact-plan.mjs';

const contract = (id: string, file: string) => ({ id, kind: 'contract' as const, files: [file] });
function fixture(): RepositorySnapshot & { registry: NonNullable<RepositorySnapshot['registry']> } {
  const files = {
    'packages/a/src/private.ts': 'export const validate = () => true;',
    'packages/a/src/index.ts': "export type { Value } from './types'; export { validate } from './private';",
    'packages/a/src/types.ts': 'export type Value = number;',
    'packages/b/src/main.ts': "import type { Value } from '../../a/src/index'; export type Result = Value;",
    'packages/c/src/main.ts': 'export const unrelated = 1;',
    'tests/a.test.ts': 'export {};',
    'tests/b.test.ts': 'export {};',
    'tests/c.test.ts': 'export {};',
    'docs/notes.md': 'Notes',
  };
  const registry = {
    schemaVersion: 1 as const,
    owners: [
      { id: 'a', paths: ['packages/a/**', 'tests/a.test.ts'], contracts: [contract('a.rules', 'tests/a.test.ts')] },
      {
        id: 'b',
        paths: ['packages/b/**', 'tests/b.test.ts'],
        contracts: [contract('b.consumer', 'tests/b.test.ts')],
        classic: true,
      },
      { id: 'c', paths: ['packages/c/**', 'tests/c.test.ts'], contracts: [contract('c.rules', 'tests/c.test.ts')] },
      { id: 'docs', paths: ['docs/**'], contracts: [], documentation: true },
    ],
  };
  return { sha: 'a'.repeat(40), files, registry };
}

describe('trusted base/head Harness impact planning', () => {
  it('follows type-only barrel consumers but excludes proven unrelated contracts', () => {
    const base = fixture();
    const head = fixture();
    head.files['packages/a/src/types.ts'] = 'export type Value = string;';
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/types.ts'] });
    expect(plan.mode).toBe('affected');
    expect(plan.selectedContracts.map((entry: { id: string }) => entry.id)).toEqual(['a.rules', 'b.consumer']);
    expect(plan.classic.required).toBe(true);
    expect(plan.reasons.b).toContain('consumes:a');
  });

  it('retains the base consumers when head deletes an import and its old owner', () => {
    const base = fixture();
    const head = fixture();
    head.files['packages/b/src/main.ts'] = 'export const standalone = true;';
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/types.ts', 'packages/b/src/main.ts'] });
    expect(plan.selectedContracts.map((entry: { id: string }) => entry.id)).toContain('b.consumer');
  });

  it('does not let a candidate registry remove its own required tests', () => {
    const base = fixture();
    const head = fixture();
    head.registry.owners[0]!.contracts = [];
    const plan = createImpactPlan({ base, head, changedPaths: ['harness/contracts.json'] });
    expect(plan.mode).toBe('full-new');
    expect(plan.selectedContracts.map((entry: { id: string }) => entry.id)).toContain('a.rules');
  });

  it('blocks a selected base test deleted without an explicit validated migration', () => {
    const base = fixture();
    const head = fixture();
    Reflect.deleteProperty(head.files, 'tests/a.test.ts');
    const plan = createImpactPlan({ base, head, changedPaths: ['tests/a.test.ts'] });
    expect(plan.status).toBe('BLOCKED');
    expect(plan.errors.join(' ')).toContain('tests/a.test.ts');
  });

  it.each(['unknown/file.ts', 'pnpm-lock.yaml', 'scripts/harness/impact-plan.mjs'])(
    'fails closed for unknown and policy/build changes: %s',
    (path) => {
      const plan = createImpactPlan({ base: fixture(), head: fixture(), changedPaths: [path] });
      expect(plan.mode).toBe('full-new');
      expect(plan.selectedContracts).toHaveLength(3);
      expect(plan.classic.required).toBe(true);
    },
  );

  it('reports missing base and never returns an empty successful selection', () => {
    const plan = createImpactPlan({ base: null, head: fixture(), changedPaths: ['docs/notes.md'] });
    expect(plan.mode).toBe('full-new');
    expect(plan.fallbackReasons).toContain('missing-base-registry');
    expect(plan.selectedContracts).toHaveLength(3);
  });

  it('keeps ordinary documentation changes out of runtime work', () => {
    const plan = createImpactPlan({ base: fixture(), head: fixture(), changedPaths: ['docs/notes.md'] });
    expect(plan.mode).toBe('affected');
    expect(plan.selectedContracts).toEqual([]);
    expect(plan.classic.required).toBe(false);
    expect(plan.documentationOnly).toBe(true);
  });

  it('selects a dynamic capability consumer through explicit declared dependencies', () => {
    const base = fixture();
    const head = fixture();
    const registry = head.registry as typeof head.registry & {
      owners: Array<{ dependencies?: { owner: string; kind: string }[] }>;
    };
    registry.owners[2]!.dependencies = [{ owner: 'a', kind: 'capability' }];
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/private.ts'] });
    expect(plan.selectedContracts.map((entry: { id: string }) => entry.id)).toContain('c.rules');
  });
  it('follows declared package exports across dynamic and require consumers', () => {
    const base = fixture();
    const head = fixture();
    for (const snapshot of [base, head]) {
      snapshot.files['packages/a/package.json'] = JSON.stringify({
        name: '@seedlands/a',
        exports: { './types': './src/types.ts' },
      });
      snapshot.files['packages/b/src/main.ts'] =
        "const x = require('@seedlands/a/types'); import('@seedlands/a/types');";
    }
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/types.ts'] });
    expect(plan.mode).toBe('affected');
    expect(plan.affectedOwners).toEqual(['a', 'b']);
  });

  it('selects both sides of a move including consumers of the deleted path', () => {
    const base = fixture();
    const head = fixture();
    head.files['packages/c/src/moved.ts'] = head.files['packages/a/src/types.ts']!;
    Reflect.deleteProperty(head.files, 'packages/a/src/types.ts');
    head.files['packages/a/src/index.ts'] =
      "export type { Value } from '../../c/src/moved'; export { validate } from './private';";
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/types.ts', 'packages/c/src/moved.ts'] });
    expect(plan.affectedOwners).toEqual(['a', 'b', 'c']);
    expect(plan.classic.required).toBe(true);
  });

  it('does not lose consumers when conditional export targets disagree', () => {
    const base = fixture();
    const head = fixture();
    for (const snapshot of [base, head]) {
      snapshot.files['packages/a/package.json'] = JSON.stringify({
        name: '@seedlands/a',
        exports: { '.': { types: './src/types.ts', import: './src/private.ts' } },
      });
      snapshot.files['packages/b/src/main.ts'] = "import '@seedlands/a';";
    }
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/private.ts'] });
    expect(plan.mode).toBe('full-new');
    expect(plan.affectedOwners).toContain('b');
    expect(plan.fallbackReasons).toContain('unresolved-dependency:b');
  });

  it('fails closed for an unknown dynamic consumer outside the inferred closure', () => {
    const base = fixture();
    const head = fixture();
    for (const snapshot of [base, head]) snapshot.files['packages/b/src/main.ts'] = 'import(runtimePath);';
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/private.ts'] });
    expect(plan.mode).toBe('full-new');
    expect(plan.affectedOwners).toContain('b');
  });

  it('propagates asset changes through a declared build dependency', () => {
    const base = fixture();
    const head = fixture();
    head.registry.owners[2]!.dependencies = [{ owner: 'a', kind: 'build' }];
    head.files['packages/a/src/texture.png'] = 'changed bytes';
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/texture.png'] });
    expect(plan.affectedOwners).toEqual(['a', 'b', 'c']);
  });

  it('refuses to trust an unresolved non-literal dynamic boundary', () => {
    const base = fixture();
    const head = fixture();
    head.files['packages/a/src/private.ts'] = 'export const load = (path) => import(path);';
    const plan = createImpactPlan({ base, head, changedPaths: ['packages/a/src/private.ts'] });
    expect(plan.mode).toBe('full-new');
    expect(plan.fallbackReasons).toContain('unresolved-dependency:a');
  });

  it('does not treat executable historical files as documentation-only success', () => {
    const base = fixture();
    const head = fixture();
    head.registry.owners[3]!.paths.push('changes/**');
    head.files['changes/example/run.ts'] = 'run();';
    const plan = createImpactPlan({ base, head, changedPaths: ['changes/example/run.ts'] });
    expect(plan.documentationOnly).toBe(false);
    expect(plan.status).toBe('BLOCKED');
  });
});
