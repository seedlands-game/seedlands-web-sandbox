import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { assembleProductPacks, type ModulePermission, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { pack as overworld } from '../../../../../../../playbooks/classic/src/pack';

const artifact: VerifiedPackArtifact = {
  ...overworld,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: (overworld.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
  },
};

const loadProductPermissions = async () => {
  const source = pathToFileURL(resolve('scripts/product-pack-admissions.mjs')).href;
  const module = (await import(source)) as {
    permissionsForProductPlaybook(id: string): readonly ModulePermission[];
  };
  return module.permissionsForProductPlaybook;
};

const includesPermission = (approved: readonly ModulePermission[], requested: ModulePermission) =>
  approved.some(
    (grant) =>
      grant.resource === requested.resource &&
      requested.operations.every((operation) => grant.operations.includes(operation)),
  );

describe('product Playbook host permissions', () => {
  it('admits every permission requested by the formal Classic Pack through the real product assembly path', async () => {
    const permissionsForProductPlaybook = await loadProductPermissions();
    const permissions = permissionsForProductPlaybook(overworld.manifest.id);
    const requested = overworld.modules.flatMap((module) => module.descriptor.permissions ?? []);

    expect(requested.filter((permission) => !includesPermission(permissions, permission))).toEqual([]);
    expect(
      assembleProductPacks([artifact], {
        approvedPlaybook: {
          id: overworld.manifest.id,
          version: overworld.manifest.version,
          integrity: artifact.integrity,
          permissions,
        },
      }).playbookId,
    ).toBe('seedlands:overworld');
  });

  it('grants Structure read/execute only to overworld and never grants write', async () => {
    const permissionsForProductPlaybook = await loadProductPermissions();
    const overworldPermissions = permissionsForProductPlaybook('seedlands:overworld');

    expect(overworldPermissions.find(({ resource }) => resource === 'seedlands.structure')).toEqual({
      resource: 'seedlands.structure',
      operations: ['read', 'execute'],
    });
    expect(
      overworldPermissions.some(
        ({ resource, operations }) => resource === 'seedlands.structure' && operations.includes('write'),
      ),
    ).toBe(false);
    for (const id of ['seedlands:click-conversion', 'seedlands:builder', 'sample:modular-world'])
      expect(permissionsForProductPlaybook(id).some(({ resource }) => resource === 'seedlands.structure')).toBe(false);
    expect(() => permissionsForProductPlaybook('example:unknown')).toThrow(/No host permission grant/);
  });

  it('still rejects the formal Classic Pack when its Structure request is not approved', async () => {
    const permissionsForProductPlaybook = await loadProductPermissions();
    const permissions = permissionsForProductPlaybook(overworld.manifest.id).filter(
      ({ resource }) => resource !== 'seedlands.structure',
    );

    expect(() =>
      assembleProductPacks([artifact], {
        approvedPlaybook: {
          id: overworld.manifest.id,
          version: overworld.manifest.version,
          integrity: artifact.integrity,
          permissions,
        },
      }),
    ).toThrow(/Pack permission was not approved by the host: seedlands:overworld -> seedlands.structure/);
  });
});
