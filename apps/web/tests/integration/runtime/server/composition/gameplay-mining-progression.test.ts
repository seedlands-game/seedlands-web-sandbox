import { expect, it } from 'vitest';
import { definePack, defineBlockRulesModule, type ModModule } from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { GameServer } from '../../../../fixtures/classic/content';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { overworldBlocks } from '../../../../../../../playbooks/classic/src/blocks';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const position: [number, number, number] = [2, 60, 0];
function setup(cloneHook?: (value: unknown) => void, saved?: ReturnType<GameServer['freezePortableSaveSnapshot']>) {
  const tools: ModModule = {
    descriptor: { id: 'test:mining-tools', version: '1.0.0', requires: [{ id: 'seedlands:items', version: '1.0.0' }] },
    register(api) {
      for (const tier of [1, 2, 3])
        api.registerItem({
          id: `test:unfamiliar-${tier}`,
          name: `Tool ${tier}`,
          itemType: 'tool',
          stackLimit: 1,
          durability: { max: 3 },
          capabilities: [{ type: 'mine', tool: 'pickaxe', tier, multiplier: tier * 2 }],
        });
    },
  };
  const rules = defineBlockRulesModule({
    moduleId: 'test:mining-rules',
    voxelDefinitions: overworldBlocks.map((definition) => ({
      ...definition,
      ...(definition.voxel === 3 ? { minimumTier: 2 } : {}),
    })),
  });
  const modules = [
    ...pack.modules.map((module) => (module.descriptor.id === 'seedlands:overworld-block-rules' ? rules : module)),
    tools,
  ];
  const root = definePack({ id: 'test:mining', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...root,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:mining': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const server = new GameServer({
    seedText: 'mining-progression',
    ...(saved
      ? {
          persistence: {
            loadSnapshot: (key: string) => structuredClone(saved.chunks.find((chunk) => chunk.key === key) ?? null),
            saveSnapshots: () => {},
            loadGameplaySnapshot: () => structuredClone(saved.gameplay),
            saveGameplaySnapshot: () => {},
          },
        }
      : {}),
    platform: {
      ...testCorePlatform,
      clone: <T>(value: T): T => {
        cloneHook?.(value);
        return structuredClone(value);
      },
    },
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'human' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  });
  if (saved) return server;
  server.editBatch({
    actorId: 'fixture',
    edits: [
      { x: 0, y: 60, z: 0, value: 0 },
      { x: 1, y: 60, z: 0, value: 0 },
      { x: 2, y: 60, z: 0, value: 3 },
    ],
  });
  server.spawnPlayer({ id: 'player', position: [0.5, 60, 0.5] });
  return server;
}
const equip = (server: GameServer, tier: number, durability = 3) =>
  server.giveItem('player', { itemId: `test:unfamiliar-${tier}`, count: 1, instance: { durability } });
const held = (server: GameServer) => server.getInventory('player').slots[0];

it('rejects inadequate quality without mutating the actual world', () => {
  const server = setup();
  equip(server, 1);
  const before = server.freezePortableSaveSnapshot();
  expect(server.beginBreak('player', position).success).toBe(false);
  expect(server.freezePortableSaveSnapshot()).toEqual(before);
});
it.each([2, 3])('uses tier %s capabilities for time and consumes one durability only on completion', (tier) => {
  const server = setup();
  equip(server, tier);
  expect(server.beginBreak('player', position).success).toBe(true);
  const required = Number((2.4 / (tier * 2)).toFixed(6));
  expect(server.getPlayerState('player').breakAction?.requiredSeconds).toBe(required);
  server.advanceGameplayRules(required / 2);
  expect(held(server)?.instance?.durability).toBe(3);
  expect(server.getVoxel(...position)).toBe(3);
  server.advanceGameplayRules(required / 2);
  expect(held(server)?.instance?.durability).toBe(2);
  expect(server.getVoxel(...position)).toBe(0);
  expect(server.queryEntities({ type: 'world-item' }).map((entity) => entity.stack)).toEqual([
    { itemId: 'stone-block', count: 1 },
  ]);
  server.advanceGameplayRules(1);
  expect(held(server)?.instance?.durability).toBe(2);
});
it('removes an exhausted tool in the same completion as the voxel and drop', () => {
  const server = setup();
  equip(server, 2, 1);
  expect(server.beginBreak('player', position).success).toBe(true);
  server.advanceGameplayRules(0.6);
  expect(held(server)).toBeNull();
  expect(server.getVoxel(...position)).toBe(0);
  expect(server.queryEntities({ type: 'world-item' })).toHaveLength(1);
});
it('changing selected tools cancels the old mining time without spending either tool', () => {
  const server = setup();
  equip(server, 3);
  equip(server, 2);
  expect(server.beginBreak('player', position).success).toBe(true);
  server.advanceGameplayRules(0.2);
  expect(server.selectHotbarSlot('player', 1)).toMatchObject({ success: true });
  expect(server.getPlayerState('player').breakAction).toBeNull();
  server.advanceGameplayRules(0.3);
  expect(server.getVoxel(...position)).toBe(3);
  expect(
    server
      .getInventory('player')
      .slots.slice(0, 2)
      .map((stack) => stack?.instance?.durability),
  ).toEqual([3, 3]);
});
it('final receipt clone failure leaves durability, voxel and drops unchanged', () => {
  let failed = false;
  const server = setup((value) => {
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'finish' && 'success' in value) {
      failed = true;
      throw new Error('test-mining-clone');
    }
  });
  equip(server, 2);
  expect(server.beginBreak('player', position).success).toBe(true);
  expect(() => server.advanceGameplayRules(0.6)).toThrow(/test-mining-clone/);
  expect(failed).toBe(true);
  expect(held(server)?.instance?.durability).toBe(3);
  expect(server.getVoxel(...position)).toBe(3);
  expect(server.queryEntities({ type: 'world-item' })).toHaveLength(0);
});

it('restores actual half-finished mining with the same tool durability and completes only once', async () => {
  const source = setup();
  equip(source, 2);
  expect(source.beginBreak('player', position).success).toBe(true);
  source.advanceGameplayRules(0.3);
  const saved = source.freezePortableSaveSnapshot();
  const target = setup(undefined, saved);
  await target.restore();
  expect(held(target)?.instance?.durability).toBe(3);
  expect(target.getPlayerState('player').breakAction?.elapsedSeconds).toBe(0.3);
  target.advanceGameplayRules(0.3);
  expect(held(target)?.instance?.durability).toBe(2);
  expect(target.getVoxel(...position)).toBe(0);
  expect(target.queryEntities({ type: 'world-item' })).toHaveLength(1);
  target.advanceGameplayRules(1);
  expect(held(target)?.instance?.durability).toBe(2);
  expect(target.queryEntities({ type: 'world-item' })).toHaveLength(1);
});
