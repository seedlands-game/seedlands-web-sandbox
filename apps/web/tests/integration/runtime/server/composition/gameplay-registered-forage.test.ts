import { describe, expect, it } from 'vitest';
import { definePack } from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { defineContentModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/content-module';
import { defineInventoryActionsModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/inventory-actions-module';
import { defineInventoryModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/inventory-module';
import { type ForageModuleConfiguration } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/forage-model';
import { defineForageModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/forage-module';
import { WorldResourceAuthorizer } from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';
import { Voxel } from '../../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const configuration: ForageModuleConfiguration = {
  sourceVoxel: Voxel.Leaves,
  drop: { itemId: 'test:berry', count: 1 },
  intervalSeconds: 120,
};

type SetupOptions = Readonly<{
  allow?: boolean;
  cloneHook?: (value: unknown) => void;
  loadedReader?: boolean;
  voxels?: ReadonlyMap<string, number>;
}>;

const key = (position: readonly number[]) => position.join(',');
const leaf = (x: number, y: number, z: number) =>
  [
    [`${x},${y},${z}`, Voxel.Leaves],
    [`${x},${y - 1},${z}`, Voxel.Air],
  ] as const;

function setup(options: SetupOptions = {}) {
  const modules = [
    defineContentModule({
      moduleId: 'test:forage-content',
      items: [
        {
          id: 'test:berry',
          name: 'Berry',
          itemType: 'food',
          stackLimit: 64,
          capabilities: [{ type: 'consume', hungerRestore: 4 }],
        },
      ],
      meleeDefinitions: [],
    }),
    defineInventoryModule(),
    defineInventoryActionsModule(),
    defineForageModule(configuration),
  ];
  const pack = definePack({ id: 'test:forage-world', kind: 'playbook', version: '1.0.0', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:forage-world': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const authority =
    options.allow === false
      ? {
          principalId: 'denied-forage-clock',
          authorizer: new WorldResourceAuthorizer(
            { principals: [{ id: 'denied-forage-clock', kind: 'system' }], rules: [] },
            composition.resources,
          ),
        }
      : createGameplaySystemAuthority(composition);
  const voxels = new Map(options.voxels ?? leaf(0, 2, 0));
  let reads = 0;
  const readVoxel = (position: readonly number[]) => {
    reads++;
    return voxels.get(key(position));
  };
  const runtime = new GameplayRuntime({
    composition,
    moduleSystemAuthority: authority,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test:player' }),
    platform: {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        options.cloneHook?.(value);
        return structuredClone(value);
      },
    },
    getVoxel: readVoxel,
    ...(options.loadedReader === false ? {} : { getLoadedVoxel: readVoxel }),
    getWorldTime: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected forage voxel edit');
    },
  });
  return { runtime, voxels, reads: () => reads };
}

const food = (runtime: GameplayRuntime) =>
  runtime.queryEntities({ type: 'world-item' }).filter((entity) => entity.stack?.itemId === configuration.drop.itemId);

describe('registered renewable forage', () => {
  it('requires the configured drop to resolve to explicit consumable food content', () => {
    const modules = [
      defineContentModule({
        moduleId: 'test:invalid-forage-content',
        items: [{ id: 'test:berry', name: 'Not food', itemType: 'resource', stackLimit: 64, capabilities: [] }],
        meleeDefinitions: [],
      }),
      defineForageModule(configuration),
    ];
    const pack = definePack({ id: 'test:invalid-forage', kind: 'playbook', version: '1.0.0', modules });
    expect(() =>
      assembleWorldPacks(
        [
          {
            ...pack,
            integrity: {
              algorithm: 'sha256',
              manifestDigest: 'a'.repeat(64),
              entryDigest: 'b'.repeat(64),
              resources: [],
            },
          },
        ],
        {
          approvedPermissions: {
            'test:invalid-forage': modules.flatMap((module) => module.descriptor.permissions ?? []),
          },
        },
      ),
    ).toThrow(/consumable food/i);
  });

  it('uses the interval checkpoint, preserves terrain, and regrows after ordinary pickup', () => {
    const { runtime, voxels } = setup();
    runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    runtime.advanceRules(119);
    expect(food(runtime)).toHaveLength(0);
    runtime.advanceRules(1);
    expect(food(runtime)).toHaveLength(1);
    expect(voxels.get('0,2,0')).toBe(Voxel.Leaves);
    expect(runtime.pickupItem('player', food(runtime)[0]!.id)).toEqual({ success: true });
    expect(food(runtime)).toHaveLength(0);
    runtime.advanceRules(120);
    expect(food(runtime)).toHaveLength(1);
    runtime.dispose();
    runtime.entities.dispose();
  });

  it('restores the same maturity frontier and runs the due interval once', () => {
    const first = setup();
    first.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    first.runtime.advanceRules(60);
    const saved = first.runtime.createSnapshot();
    const restored = setup();
    restored.runtime.restoreSnapshot(saved);
    restored.runtime.advanceRules(59);
    expect(food(restored.runtime)).toHaveLength(0);
    restored.runtime.advanceRules(1);
    expect(food(restored.runtime)).toHaveLength(1);
    restored.runtime.advanceRules(119);
    expect(food(restored.runtime)).toHaveLength(1);
    first.runtime.dispose();
    restored.runtime.dispose();
    first.runtime.entities.dispose();
    restored.runtime.entities.dispose();
  });

  it('does not fall back to a generating voxel reader when no loaded-world reader is supplied', () => {
    const fixture = setup({ loadedReader: false });
    fixture.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    fixture.runtime.advanceRules(120);
    expect(food(fixture.runtime)).toHaveLength(0);
    expect(fixture.reads()).toBe(0);
    fixture.runtime.dispose();
    fixture.runtime.entities.dispose();
  });

  it('deduplicates overlapping observers and sources, caps drops, and never reads beyond the configured window', () => {
    const overlapping = setup();
    overlapping.runtime.spawnPlayer({ id: 'b', position: [0.5, 0, 0.5] });
    overlapping.runtime.spawnPlayer({ id: 'a', position: [0.5, 0, 0.5] });
    overlapping.runtime.advanceRules(120);
    expect(food(overlapping.runtime)).toHaveLength(1);
    overlapping.runtime.dispose();
    overlapping.runtime.entities.dispose();

    const voxels = new Map<string, number>();
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) for (const entry of leaf(x, 8, z)) voxels.set(entry[0], entry[1]);
    const fixture = setup({ voxels });
    fixture.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    fixture.runtime.advanceRules(120);
    expect(food(fixture.runtime)).toHaveLength(16);
    expect(fixture.reads()).toBeLessThanOrEqual(2 * 9 * 9 * 9 + 64);
    fixture.runtime.dispose();
    fixture.runtime.entities.dispose();
  });

  it('rechecks loaded terrain after candidate projection before preparing any spawn', () => {
    const voxels = new Map<string, number>(leaf(0, 2, 0));
    let armed = false;
    const fixture = setup({
      voxels,
      cloneHook(value) {
        if (armed && value && typeof value === 'object' && 'kind' in value && value.kind === 'forage-spawn') {
          armed = false;
          fixture.voxels.set('0,2,0', Voxel.Wood);
        }
      },
    });
    fixture.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    armed = true;
    expect(() => fixture.runtime.advanceRules(120)).toThrow(/stale|differs|source/i);
    expect(food(fixture.runtime)).toHaveLength(0);
    fixture.runtime.dispose();
    fixture.runtime.entities.dispose();
  });

  it('suppresses occupied drops and ignores dead, creative, unloaded, missing-source, and blocked-source observations', () => {
    const occupied = setup();
    occupied.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    occupied.runtime.spawnWorldItem([0.5, 1.5, 0.5], configuration.drop);
    occupied.runtime.advanceRules(120);
    expect(food(occupied.runtime)).toHaveLength(1);
    occupied.runtime.dispose();
    occupied.runtime.entities.dispose();

    for (const variant of ['dead', 'creative', 'unloaded', 'missing-source', 'blocked'] as const) {
      const voxels = new Map<string, number>(leaf(0, 2, 0));
      if (variant === 'unloaded') voxels.clear();
      if (variant === 'missing-source') voxels.set('0,2,0', Voxel.Wood);
      if (variant === 'blocked') voxels.set('0,1,0', Voxel.Stone);
      const fixture = setup({ voxels });
      fixture.runtime.spawn({
        id: 'player',
        type: 'player',
        position: [0.5, 0, 0.5],
        ...(variant === 'dead' ? { health: 0 } : {}),
      });
      if (variant === 'creative') {
        const snapshot = fixture.runtime.createSnapshot();
        const actorIndex = snapshot.entityStore.actors.findIndex((entry) => entry.entityId === 'player');
        const actor = snapshot.entityStore.actors[actorIndex]!;
        snapshot.entityStore.actors[actorIndex] = {
          ...actor,
          mode: { version: 1, value: 'creative', revision: 1 },
          flight: { version: 1, enabled: false, revision: 1 },
        };
        fixture.runtime.restoreSnapshot(snapshot);
      }
      fixture.runtime.advanceRules(120);
      expect(food(fixture.runtime), variant).toHaveLength(0);
      fixture.runtime.dispose();
      fixture.runtime.entities.dispose();
    }
  });

  it('keeps ECS untouched when system authority is denied or final result cloning fails', () => {
    const denied = setup({ allow: false });
    denied.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    expect(() => denied.runtime.advanceRules(120)).toThrow(/denied/i);
    expect(food(denied.runtime)).toHaveLength(0);
    denied.runtime.dispose();
    denied.runtime.entities.dispose();

    let armed = false;
    const multiple = new Map<string, number>();
    for (const entry of [...leaf(0, 2, 0), ...leaf(3, 2, 0)]) multiple.set(entry[0], entry[1]);
    const failed = setup({
      voxels: multiple,
      cloneHook(value) {
        if (
          armed &&
          value &&
          typeof value === 'object' &&
          'version' in value &&
          'spawned' in value &&
          Array.isArray(value.spawned)
        )
          throw new Error('fixture-forage-final-clone');
      },
    });
    failed.runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
    armed = true;
    expect(() => failed.runtime.advanceRules(120)).toThrow(/fixture-forage-final-clone/);
    armed = false;
    expect(food(failed.runtime)).toHaveLength(0);
    failed.runtime.dispose();
    failed.runtime.entities.dispose();
  });
});
