import { describe, expect, it, vi } from 'vitest';

import { definePack, type ModModule, type PackDefinition, type PackManifest } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks, createWorldFromPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';

const digest = (character: string) => character.repeat(64);

const artifact = (manifest: PackManifest, modules: readonly ModModule[]): VerifiedPackArtifact => ({
  manifest,
  modules,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: digest('a'),
    entryDigest: digest('b'),
    resources: Object.freeze((manifest.resources ?? []).map((path) => ({ path, digest: digest('c') }))),
  },
});

const verified = (definition: PackDefinition): VerifiedPackArtifact =>
  artifact(definition.manifest, definition.modules);

const module = (descriptor: ModModule['descriptor'], register: ModModule['register'] = () => undefined): ModModule =>
  Object.freeze({ descriptor: Object.freeze(descriptor), register });

describe('per-world Pack assembly', () => {
  it('produces one stable frozen definition for every input order', () => {
    const items = module(
      {
        id: 'example:items',
        version: '1.0.0',
        provides: [{ id: 'example:items', version: '1.0.0' }],
      },
      (api) => {
        api.registerItem({ id: 'example:copper', name: 'Copper', stackLimit: 64 });
        api.registerItem({ id: 'example:copper-block', name: 'Copper Block', stackLimit: 64 });
        api.provideCapability('example:items', { itemId: 'example:copper' });
      },
    );
    const recipes = module(
      {
        id: 'example:recipes',
        version: '1.0.0',
        requires: [{ id: 'example:items', version: '1.0.0' }],
      },
      (api) => {
        const capability = api.requireCapability<{ itemId: string }>('example:items');
        api.registerRecipe({
          id: 'example:copper-block',
          inputs: [{ itemId: capability.itemId, count: 9 }],
          outputs: [{ itemId: 'example:copper-block', count: 1 }],
        });
      },
    );
    const playbook = artifact(
      {
        schemaVersion: 1,
        id: 'example:playbook',
        version: '1.0.0',
        kind: 'playbook',
        entry: './playbook.mjs',
        modules: [recipes.descriptor],
        dependencies: [{ id: 'example:content', version: '1.0.0' }],
      },
      [recipes],
    );
    const content = artifact(
      {
        schemaVersion: 1,
        id: 'example:content',
        version: '1.0.0',
        kind: 'extension',
        entry: './content.mjs',
        modules: [items.descriptor],
      },
      [items],
    );

    const a = assembleWorldPacks([playbook, content]);
    const b = assembleWorldPacks([content, playbook]);

    expect(a.packOrder).toEqual(['example:content', 'example:playbook']);
    expect(a.moduleOrder).toEqual(['example:items', 'example:recipes']);
    expect(a.definitionMap).toEqual(b.definitionMap);
    expect(a.registrations.items).toEqual([
      { id: 'example:copper', name: 'Copper', stackLimit: 64 },
      { id: 'example:copper-block', name: 'Copper Block', stackLimit: 64 },
    ]);
    expect(a.registrations.recipes).toEqual([
      {
        id: 'example:copper-block',
        inputs: [{ itemId: 'example:copper', count: 9 }],
        outputs: [{ itemId: 'example:copper-block', count: 1 }],
      },
    ]);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.registrations.items)).toBe(true);
  });

  it.each([
    [
      'duplicate Pack id',
      () => {
        const pack = verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook' }));
        return [pack, pack];
      },
    ],
    [
      'cyclic Pack dependency',
      () => [
        verified(
          definePack({
            id: 'example:a',
            version: '1.0.0',
            kind: 'playbook',
            dependencies: [{ id: 'example:b', version: '1.0.0' }],
          }),
        ),
        verified(
          definePack({
            id: 'example:b',
            version: '1.0.0',
            kind: 'extension',
            dependencies: [{ id: 'example:a', version: '1.0.0' }],
          }),
        ),
      ],
    ],
    [
      'missing provider',
      () => [
        verified(
          definePack({
            id: 'example:root',
            version: '1.0.0',
            kind: 'playbook',
            modules: [
              module({
                id: 'example:consumer',
                version: '1.0.0',
                requires: [{ id: 'example:missing', version: '1.0.0' }],
              }),
            ],
          }),
        ),
      ],
    ],
    [
      'incompatible exact provider version',
      () => [
        verified(
          definePack({
            id: 'example:root',
            version: '1.0.0',
            kind: 'playbook',
            modules: [
              module({
                id: 'example:consumer',
                version: '1.0.0',
                requires: [{ id: 'example:capability', version: '2.0.0' }],
              }),
              module(
                {
                  id: 'example:provider',
                  version: '1.0.0',
                  provides: [{ id: 'example:capability', version: '1.0.0' }],
                },
                (api) => api.provideCapability('example:capability', {}),
              ),
            ],
          }),
        ),
      ],
    ],
    [
      'cyclic module capability dependency',
      () => [
        verified(
          definePack({
            id: 'example:root',
            version: '1.0.0',
            kind: 'playbook',
            modules: [
              module(
                {
                  id: 'example:left',
                  version: '1.0.0',
                  provides: [{ id: 'example:left-cap', version: '1.0.0' }],
                  requires: [{ id: 'example:right-cap', version: '1.0.0' }],
                },
                (api) => api.provideCapability('example:left-cap', {}),
              ),
              module(
                {
                  id: 'example:right',
                  version: '1.0.0',
                  provides: [{ id: 'example:right-cap', version: '1.0.0' }],
                  requires: [{ id: 'example:left-cap', version: '1.0.0' }],
                },
                (api) => api.provideCapability('example:right-cap', {}),
              ),
            ],
          }),
        ),
      ],
    ],
    [
      'two Playbooks',
      () => [
        verified(definePack({ id: 'example:a', version: '1.0.0', kind: 'playbook' })),
        verified(definePack({ id: 'example:b', version: '1.0.0', kind: 'playbook' })),
      ],
    ],
  ])('rejects %s before creating world state', (_case, build) => {
    const create = vi.fn();
    expect(() => createWorldFromPacks(build(), {}, create)).toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects duplicate definitions, unknown item references and an unapproved capability replacement', () => {
    const first = module(
      { id: 'example:first', version: '1.0.0', provides: [{ id: 'example:crafting', version: '1.0.0' }] },
      (api) => api.registerItem({ id: 'example:same', name: 'First', stackLimit: 1 }),
    );
    const second = module(
      {
        id: 'example:second',
        version: '1.0.0',
        provides: [{ id: 'example:crafting', version: '1.0.0' }],
        replaces: [{ id: 'example:crafting', version: '1.0.0' }],
      },
      (api) => api.registerItem({ id: 'example:same', name: 'Second', stackLimit: 1 }),
    );
    expect(() =>
      assembleWorldPacks([
        verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [first] })),
        verified(
          definePack({
            id: 'example:addon',
            version: '1.0.0',
            kind: 'extension',
            modules: [
              module({ id: 'example:duplicate', version: '1.0.0' }, (api) =>
                api.registerItem({ id: 'example:same', name: 'Duplicate', stackLimit: 1 }),
              ),
            ],
          }),
        ),
      ]),
    ).toThrow(/duplicate item/i);
    expect(() =>
      assembleWorldPacks([
        verified(
          definePack({
            id: 'example:root',
            version: '1.0.0',
            kind: 'playbook',
            modules: [
              module({ id: 'example:recipe', version: '1.0.0' }, (api) =>
                api.registerRecipe({
                  id: 'example:bad',
                  inputs: [{ itemId: 'example:missing', count: 1 }],
                  outputs: [{ itemId: 'example:also-missing', count: 1 }],
                }),
              ),
            ],
          }),
        ),
      ]),
    ).toThrow(/unknown item/i);
    expect(() =>
      assembleWorldPacks([
        verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [first] })),
        verified(definePack({ id: 'example:addon', version: '1.0.0', kind: 'extension', modules: [second] })),
      ]),
    ).toThrow(/replacement|provider/i);
  });

  it('closes a cached author registration facade after deterministic assembly', () => {
    let cached: Parameters<ModModule['register']>[0] | undefined;
    const source = module({ id: 'example:source', version: '1.0.0' }, (api) => {
      cached = api;
      api.registerItem({ id: 'example:inside', name: 'Inside', stackLimit: 1 });
    });
    assembleWorldPacks([
      verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [source] })),
    ]);
    expect(() => cached?.registerItem({ id: 'example:late', name: 'Late', stackLimit: 1 })).toThrow(/closed/i);
  });

  it('requires a verified receipt at the world creation boundary and accepts a valid receipt', () => {
    const definition = definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook' });
    const create = vi.fn(() => 'world');
    expect(() => createWorldFromPacks([definition as unknown as VerifiedPackArtifact], {}, create)).toThrow(
      /integrity/i,
    );
    expect(create).not.toHaveBeenCalled();
    expect(createWorldFromPacks([verified(definition)], {}, create)).toBe('world');
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects a loaded descriptor that differs from the locked manifest before registration or world creation', () => {
    const register = vi.fn();
    const loaded = module(
      {
        id: 'example:module',
        version: '1.0.0',
        resources: [{ id: 'example.inventory', operations: ['read', 'execute'] }],
        permissions: [{ resource: 'example.inventory', operations: ['execute'] }],
      },
      register,
    );
    const definition = definePack({
      id: 'example:root',
      version: '1.0.0',
      kind: 'playbook',
      modules: [loaded],
    });
    const create = vi.fn();
    const mismatched = verified(definition);
    const manifestOnlyRead: VerifiedPackArtifact = {
      ...mismatched,
      manifest: {
        ...mismatched.manifest,
        modules: [
          {
            ...loaded.descriptor,
            permissions: [{ resource: 'example.inventory', operations: ['read'] }],
          },
        ],
      },
    };
    expect(() => createWorldFromPacks([manifestOnlyRead], {}, create)).toThrow(/does not match manifest/i);
    expect(register).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects version ranges instead of guessing semver compatibility', () => {
    expect(() =>
      assembleWorldPacks([verified(definePack({ id: 'example:root', version: '^1.0.0', kind: 'playbook' }))]),
    ).toThrow(/exact-version/i);
  });

  it.each([
    [
      'same provider twice',
      [
        { capability: 'example:capability', moduleId: 'example:provider' },
        { capability: 'example:capability', moduleId: 'example:provider' },
      ],
    ],
    [
      'conflicting providers',
      [
        { capability: 'example:capability', moduleId: 'example:provider' },
        { capability: 'example:capability', moduleId: 'example:other' },
      ],
    ],
  ])('rejects duplicate Playbook provider selection: %s', (_case, providerSelections) => {
    const register = vi.fn((api: Parameters<ModModule['register']>[0]) =>
      api.provideCapability('example:capability', {}),
    );
    const provider = module(
      {
        id: 'example:provider',
        version: '1.0.0',
        provides: [{ id: 'example:capability', version: '1.0.0' }],
      },
      register,
    );
    const create = vi.fn();
    expect(() =>
      createWorldFromPacks(
        [
          verified(
            definePack({
              id: 'example:root',
              version: '1.0.0',
              kind: 'playbook',
              modules: [provider],
              providerSelections,
            }),
          ),
        ],
        {},
        create,
      ),
    ).toThrow(/duplicate.*provider selection/i);
    expect(register).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('composition checkpoint identity', () => {
  it('retains frozen verified Pack digests independently of caller-owned receipts', () => {
    const input = verified(definePack({ id: 'example:lock', version: '1.0.0', kind: 'playbook' }));
    const composition = assembleWorldPacks([input]);
    expect(composition.packLock).toEqual([{ id: 'example:lock', version: '1.0.0', integrity: input.integrity }]);
    const before = JSON.stringify(composition.packLock);
    (input.integrity as { entryDigest: string }).entryDigest = 'f'.repeat(64);
    expect(JSON.stringify(composition.packLock)).toBe(before);
    expect(Object.isFrozen(composition.packLock[0].integrity)).toBe(true);
  });
});
