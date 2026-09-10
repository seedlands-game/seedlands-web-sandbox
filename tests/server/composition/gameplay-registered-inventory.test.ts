import { describe, expect, it } from 'vitest';
import { definePack, defineInventoryModule, type ModModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createRegisteredOperationRuntime } from '@seedlands/game-core/server/composition/host-api';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { createGameplayContent } from '../../../packages/game-core/src/server/gameplay/gameplay-content';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../support/core-platform';

function setup(selfOnly = false, veto = false) {
  const gameplay = new GameplayRuntime({
    platform: testCorePlatform,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
    getWorldTime: () => 9,
    content: createGameplayContent({
      items: [{ id: 'test:token', name: 'Token', itemType: 'resource', stackLimit: 8, capabilities: [] }],
      recipes: [],
      meleeDefinitions: [],
    }),
  });
  gameplay.spawnPlayer({ id: 'alice', position: [0, 1, 0] });
  gameplay.spawn({ id: 'bob', type: 'npc', position: [1, 1, 0] });
  gameplay.giveItem('alice', { itemId: 'test:token', count: 5 });
  const items: ModModule = {
    descriptor: { id: 'test:items', version: '1.0.0', provides: [{ id: 'seedlands:items', version: '1.0.0' }] },
    register: (api) => api.provideCapability('seedlands:items', gameplay.content.items),
  };
  const inventory = defineInventoryModule();
  const rule: ModModule = {
    descriptor: { id: 'test:rule', version: '1.0.0', permissions: inventory.descriptor.permissions },
    register: (api) =>
      api.registerRule({
        id: 'test:deny',
        operationId: 'seedlands:inventory-transfer',
        apply: () => (veto ? { reject: 'transfer-disabled' } : undefined),
      }),
  };
  const pack = definePack({ id: 'test:root', version: '1.0.0', kind: 'playbook', modules: [items, inventory, rule] });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:root': inventory.descriptor.permissions! } },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['seedlands.inventory'],
          operations: ['execute', 'read', 'write'],
          scope: selfOnly ? 'self' : 'any',
        },
      ],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone: structuredClone,
    state: gameplay.inventoryState,
  });
  return {
    gameplay,
    runtime,
    execute: runtime.bind({ moduleId: 'seedlands:inventory-module', principalId: 'human', originalActorId: 'alice' }),
  };
}
const transfer = {
  operationId: 'seedlands:inventory-transfer',
  target: { kind: 'entity' as const, entityId: 'alice' },
  input: { recipientId: 'bob', itemId: 'test:token', count: 3 },
};

describe('registered inventory module with the actual ECS owner', () => {
  it('commits player and NPC inventory together, marks gameplay dirty, and persists both', () => {
    const world = setup();
    const before = world.gameplay.gameplayRevision;
    expect(world.execute.invoke(transfer)).toMatchObject({ ok: true });
    expect(world.gameplay.getInventory('alice').slots[0]).toEqual({ itemId: 'test:token', count: 2 });
    expect(world.gameplay.getInventory('bob').slots[0]).toEqual({ itemId: 'test:token', count: 3 });
    expect(world.gameplay.gameplayRevision).toBe(before + 1);
    const saved = world.gameplay.createSnapshot();
    world.gameplay.restoreSnapshot(saved);
    expect(world.gameplay.getInventory('bob').slots[0]?.count).toBe(3);
  });
  it.each([
    [true, false, 'WORLD_PERMISSION_DENIED'],
    [false, true, 'RULE_REJECTED'],
  ] as const)('keeps both inventories for denied transfer (%s/%s)', (selfOnly, veto, code) => {
    const world = setup(selfOnly, veto);
    const before = world.gameplay.createSnapshot();
    expect(world.execute.invoke(transfer)).toMatchObject({ ok: false, code });
    expect(world.gameplay.createSnapshot()).toEqual(before);
  });
  it('rejects exhausted gameplay revision before either inventory is replaced or a fact is emitted', () => {
    const world = setup();
    const exhausted = world.gameplay.createSnapshot();
    exhausted.revision = Number.MAX_SAFE_INTEGER;
    world.gameplay.restoreSnapshot(exhausted);
    const before = world.gameplay.createSnapshot();
    let facts = 0;
    world.execute.subscribe(() => {
      facts++;
    });
    expect(world.execute.invoke(transfer)).toMatchObject({ ok: false });
    expect(world.gameplay.createSnapshot()).toEqual(before);
    expect(facts).toBe(0);
  });
  it('rejects an old inventory observation after restoring the same gameplay revision', () => {
    const world = setup();
    const key = { componentId: 'seedlands:inventory', target: transfer.target };
    const snapshot = world.gameplay.inventoryState.read(key);
    const saved = world.gameplay.createSnapshot();
    world.gameplay.restoreSnapshot(saved);
    const result = world.gameplay.inventoryState.commit(
      [{ address: key, revision: snapshot.revision }],
      [{ address: key, value: snapshot.value }],
    );
    expect(result.ok).toBe(false);
    expect(world.gameplay.getInventory('alice').slots[0]?.count).toBe(5);
  });
});
