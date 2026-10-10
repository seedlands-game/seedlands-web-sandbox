import { describe, expect, it, vi } from 'vitest';
import { CropRuntime, type CropRecord } from '../src/server/gameplay/crop-runtime';
import { EntityStore } from '../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../src/server/gameplay/item-registry';
import type { CropPolicy } from '../src/server/gameplay/modules/crop-policy';

const position = [12, 34, -7] as const;
const supportedSoil = 3100;
const secondSupportedSoil = 3101;
const unsupportedSoil = 3200;
const policy: CropPolicy = {
  soilVoxels: [supportedSoil, secondSupportedSoil],
  emptyAboveVoxels: [3102],
  waterVoxels: [3103],
  seedItemId: 'sample:seed',
  matureDrops: [{ itemId: 'sample:produce', count: 1 }],
  immatureDrops: [{ itemId: 'sample:seed', count: 1 }],
};
const entities = () =>
  new EntityStore(
    createItemDefinitionRegistry([
      { id: 'sample:seed', name: 'Seed', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:produce', name: 'Produce', itemType: 'resource', stackLimit: 64, capabilities: [] },
    ]),
  );
const makeOwner = (cropPolicy: CropPolicy | null = policy) =>
  new CropRuntime({
    ...(cropPolicy ? { policy: cropPolicy } : {}),
    seed: 17,
    entities: entities(),
    getLoadedVoxel: () => undefined,
    changed: vi.fn(),
  });
const initialCrop: CropRecord = { position, stage: 2, subSeconds: 0.4 };
const installCrop = (owner: CropRuntime, crop: CropRecord = initialCrop) => {
  const participant = owner.prepareChange(position, null, crop);
  participant.validate();
  participant.apply();
  return owner.at(position)!;
};
const commit = (participant: Readonly<{ validate(): void; apply(): void }>) => {
  participant.validate();
  participant.apply();
};

describe('CropRuntime support transition participant', () => {
  it('preserves the sole crop owner when soil changes between configured supported voxels', () => {
    const owner = makeOwner();
    const crop = installCrop(owner);

    const transition = owner.prepareSupportTransition(position, crop, secondSupportedSoil);
    commit(transition);

    expect(owner.at(position)).toEqual(crop);
    expect(owner.checkpoint().crops).toEqual([crop]);
  });

  it('removes the crop owner when support changes to an arbitrary unsupported voxel', () => {
    const owner = makeOwner();
    const crop = installCrop(owner);

    const transition = owner.prepareSupportTransition(position, crop, unsupportedSoil);
    commit(transition);

    expect(owner.at(position)).toBeNull();
    expect(owner.checkpoint().crops).toEqual([]);
  });

  it('rejects a prepared transition after the observed crop changes, before applying cleanup', () => {
    const owner = makeOwner();
    const crop = installCrop(owner);
    const transition = owner.prepareSupportTransition(position, crop, unsupportedSoil);
    const concurrentlyAdvanced = { ...crop, stage: 3, subSeconds: 0 };
    const externalChange = owner.prepareChange(position, crop, concurrentlyAdvanced);
    commit(externalChange);

    expect(() => transition.validate()).toThrow(/crop-interaction-stale/);
    expect(owner.at(position)).toEqual(concurrentlyAdvanced);
    expect(owner.checkpoint().crops).toEqual([concurrentlyAdvanced]);
  });

  it('rejects a null expected observation when a crop already exists', () => {
    const owner = makeOwner();
    installCrop(owner);

    expect(() => owner.prepareSupportTransition(position, null, unsupportedSoil)).toThrow(/crop-interaction-stale/);
    expect(owner.at(position)).toEqual(initialCrop);
  });

  it.each([-1, 1.5, Number.NaN, 65_536])('rejects invalid resulting voxel %s without changing the crop', (voxel) => {
    const owner = makeOwner();
    installCrop(owner);

    expect(() => owner.prepareSupportTransition(position, initialCrop, voxel)).toThrow(/support voxel/i);
    expect(owner.at(position)).toEqual(initialCrop);
  });

  it('fails closed when no crop policy is registered', () => {
    const owner = makeOwner(null);

    expect(() => owner.prepareSupportTransition(position, null, unsupportedSoil)).toThrow(/crop-policy-unavailable/);
    expect(owner.checkpoint().crops).toEqual([]);
  });
});
