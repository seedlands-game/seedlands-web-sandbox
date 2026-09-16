import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/stdlib/server/headless/headless-session';
import { GameServer } from '@seedlands/stdlib/server/game-server';
import { MemoryGamePersistence } from '@seedlands/stdlib/server/persistence/memory-game-persistence';
import {
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  worldgenProviderForComposition,
} from '@seedlands/stdlib/host';
import type { FrozenGameSaveSnapshot } from '@seedlands/stdlib/server/persistence/game-save-snapshot';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { decodeCheckpointRequest } from '../../../../../scripts/headless/jsonl-transport';
import { createClassicComposition } from '../../fixtures/classic/content';

const fixtureDirectory = 'apps/web/tests/fixtures/checkpoints';

async function frozenSnapshot(name: 'base' | 'station'): Promise<FrozenGameSaveSnapshot> {
  const bytes = await readFile(`${fixtureDirectory}/${name}-checkpoint.json.gz`);
  const wire = decodeCheckpointRequest(JSON.parse(gunzipSync(bytes).toString('utf8')) as unknown);
  if (!wire || typeof wire !== 'object' || !('args' in wire) || !Array.isArray(wire.args))
    throw new TypeError(`Frozen ${name} checkpoint wire is invalid.`);
  const request = wire.args[0] as { snapshot?: unknown } | undefined;
  if (!request?.snapshot) throw new TypeError(`Frozen ${name} checkpoint snapshot is missing.`);
  return request.snapshot as FrozenGameSaveSnapshot;
}

const createSession = (seedText: string) =>
  HeadlessSession.create({ seedText, platform: testCorePlatform, createComposition: createClassicComposition });

describe('Kernel migration frozen checkpoint compatibility', () => {
  it('restores the exact old Classic base identity and preserves inventory, world edits, and running actions', async () => {
    const session = await createSession('migration-current-base');
    try {
      const before = await session.world.identity();
      const restored = await session.world.checkpoint({ kind: 'restore', snapshot: await frozenSnapshot('base') });
      expect(restored, JSON.stringify(restored)).toMatchObject({ ok: true });
      const identity = await session.world.identity();
      expect(identity).toMatchObject({ ok: true, data: { seedText: 'kernel-migration-c18a890-v1' } });
      if (!before.ok || !identity.ok) throw new Error('Headless identity unavailable.');
      expect(identity.data.epoch).not.toBe(before.data.epoch);
      expect(await session.world.clock({ kind: 'advance', elapsedMs: 100 })).toMatchObject({ ok: true });
      expect(await session.world.inspect({ kind: 'voxel', position: [2, 30, 2] })).toMatchObject({
        ok: true,
        data: { voxel: 4 },
      });
      const inventory = session.runtime.server.getInventory(identity.data.playerId);
      expect(inventory.slots.find((slot) => slot?.itemId === 'berry')?.count).toBe(3);
      expect(inventory.slots.find((slot) => slot?.itemId === 'wood-axe')?.instance?.durability).toBe(41);
      const observation = await session.world.character({ kind: 'observe', entityId: 'npc-3', sinceCursor: 0 });
      expect(observation).toMatchObject({ ok: true, data: { kind: 'observation' } });
      if (!observation.ok || observation.data.kind !== 'observation')
        throw new Error('Character observation unavailable.');
      expect(
        observation.data.observation.events.filter(
          (event) => event.type === 'speech' && event.text === 'baseline-once',
        ),
      ).toHaveLength(1);
      expect(
        observation.data.observation.character.behaviorTree.runtime.skills.some(
          (skill) => skill.nodeId === 'wait-after' && skill.status === 'running',
        ),
      ).toBe(true);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('completes one in-flight furnace output after restore and does not replay it', async () => {
    const session = await createSession('migration-current-station');
    try {
      const restored = await session.world.checkpoint({ kind: 'restore', snapshot: await frozenSnapshot('station') });
      expect(restored, JSON.stringify(restored)).toMatchObject({ ok: true });
      const identity = await session.world.identity();
      if (!identity.ok) throw new Error(identity.error.message);
      const station = () => {
        const component = session.runtime.server
          .getNearbyStations(identity.data.playerId)
          .find((entry) => entry.reference.entityId === 'station-3')?.component;
        return component?.kind === 'furnace' ? component.furnace : undefined;
      };
      expect(station()).toMatchObject({
        activeRecipeId: 'smelt-iron',
        input: { itemId: 'raw-iron', count: 1 },
        output: null,
        remainingFuelSeconds: 18,
        progressSeconds: 2,
      });
      expect(await session.world.clock({ kind: 'advance', elapsedMs: 3_000 })).toMatchObject({ ok: true });
      const completed = station();
      expect(completed).toEqual({
        version: 1,
        input: null,
        fuel: null,
        output: { itemId: 'iron-ingot', count: 1 },
        activeRecipeId: null,
        remainingFuelSeconds: 15,
        progressSeconds: 0,
      });
      expect(await session.world.clock({ kind: 'advance', elapsedMs: 1_000 })).toMatchObject({ ok: true });
      expect(station()).toEqual(completed);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('rejects an arbitrary predecessor digest without replacing the live owner', async () => {
    const session = await createSession('migration-reject-digest');
    try {
      const source = await frozenSnapshot('base');
      const composition = source.gameplay.composition!;
      const firstPack = composition.packLock[0];
      const snapshot: FrozenGameSaveSnapshot = {
        ...source,
        gameplay: {
          ...source.gameplay,
          composition: {
            ...composition,
            packLock: [
              {
                ...firstPack,
                integrity: { ...firstPack.integrity, manifestDigest: 'f'.repeat(64) },
              },
            ],
          },
        },
      };
      const before = await session.world.identity();
      const rejection = await session.world.checkpoint({ kind: 'restore', snapshot });
      expect(rejection, JSON.stringify(rejection)).toMatchObject({
        ok: false,
        error: {
          code: 'WORLD_REQUEST_INVALID',
          kind: 'validation',
          message: 'Gameplay composition identity is missing or incompatible.',
        },
      });
      expect(await session.world.identity()).toEqual(before);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('keeps the live owner when the restored gameplay participant conflicts with station terrain', async () => {
    const session = await createSession('migration-reject-participant');
    try {
      const snapshot = structuredClone(await frozenSnapshot('station'));
      const chunk = snapshot.chunks.find(({ key }) => key === '0,0,0');
      if (!chunk) throw new Error('Frozen station chunk is missing.');
      const stationIndex = 2 + 2 * 32 + 30 * 32 ** 2;
      expect(chunk.voxels[stationIndex]).toBe(13);
      chunk.voxels[stationIndex] = 0;
      const before = await session.world.identity();
      const rejection = await session.world.checkpoint({ kind: 'restore', snapshot });
      expect(rejection).toMatchObject({
        ok: false,
        error: { kind: 'validation', message: 'Persisted station entity has no matching voxel.' },
      });
      expect(await session.world.identity()).toEqual(before);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('keeps a live GameServer owner intact when station validation rejects a prepared gameplay replacement', async () => {
    const snapshot = structuredClone(await frozenSnapshot('station'));
    const chunk = snapshot.chunks.find(({ key }) => key === '0,0,0');
    if (!chunk) throw new Error('Frozen station chunk is missing.');
    chunk.voxels[2 + 2 * 32 + 30 * 32 ** 2] = 0;
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    persistence.saveFrozenSnapshot(snapshot);
    const composition = createClassicComposition();
    const server = new GameServer({
      seedText: snapshot.seedText,
      generatorVersion: snapshot.generatorVersion,
      platform: testCorePlatform,
      persistence,
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
      moduleSystemAuthority: createGameplaySystemAuthority(composition),
      worldgenProvider: worldgenProviderForComposition(composition),
    });
    server.spawnPlayer({ id: 'live-player', position: [0.5, 1, 0.5] });
    server.giveItem('live-player', { itemId: 'berry', count: 2 });
    const before = server.freezeSaveSnapshot();

    await expect(server.restore()).rejects.toThrow('Persisted station entity has no matching voxel.');
    expect(server.freezeSaveSnapshot()).toEqual(before);
    expect(server.getInventory('live-player').slots[0]).toEqual({ itemId: 'berry', count: 2 });
    server.disposeGameplay();
  }, 30_000);
});
