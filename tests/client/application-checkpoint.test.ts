import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/game-core/server/headless/headless-session';
import { WorldResourceAuthorizer } from '@seedlands/game-core/server/harness/world-authorization';
import { testCorePlatform } from '../support/core-platform';
import {
  captureApplicationCheckpoint,
  decodeApplicationCheckpoint,
  encodeApplicationCheckpoint,
} from '../../apps/web/src/client/persistence/application-checkpoint';
import { browserWorldOwnerPolicy } from '../../apps/web/src/worker/authority-worker-world-policy';

describe('application checkpoint ownership', () => {
  it('pairs a real world snapshot with cognition and rejects tampering before restore', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'application-checkpoint' });
    try {
      await session.world.clock({ kind: 'pause' });
      const checkpoint = await captureApplicationCheckpoint(
        session.world,
        async () => JSON.stringify({ memory: '昨日一起吃过浆果', journal: ['yesterday'] }),
        'timeline-yesterday',
      );
      const decoded = await decodeApplicationCheckpoint(encodeApplicationCheckpoint(checkpoint));
      expect(decoded.worldHash).toBe(checkpoint.worldHash);
      expect(decoded.world.chunks[0]?.voxels).toBeInstanceOf(Uint16Array);
      const restored = await session.world.checkpoint({ kind: 'restore', snapshot: decoded.world });
      expect(restored.ok).toBe(true);
      const before = await session.world.identity();
      await expect(
        decodeApplicationCheckpoint(encodeApplicationCheckpoint({ ...checkpoint, cognition: 'future memory' })),
      ).rejects.toThrow('认知存档校验失败');
      await expect(
        decodeApplicationCheckpoint(
          encodeApplicationCheckpoint({ ...checkpoint, world: { ...checkpoint.world, seedText: 'other' } }),
        ),
      ).rejects.toThrow('世界存档校验失败');
      expect(await session.world.identity()).toEqual(before);
    } finally {
      await session.dispose();
    }
  }, 15000);
  it('gives the browser owner checkpoint access without granting global inspect or resident access', () => {
    const auth = new WorldResourceAuthorizer(browserWorldOwnerPolicy('owner', 'player'));
    for (const operation of ['export', 'restore'] as const)
      expect(
        auth.authorize('owner', { resource: 'world.checkpoint', operation, target: { kind: 'world' } }).allowed,
      ).toBe(true);
    expect(
      auth.authorize('owner', {
        resource: 'world.actor',
        operation: 'read',
        target: { kind: 'entity', entityId: 'npc' },
      }).allowed,
    ).toBe(false);
    expect(
      auth.authorize('resident', { resource: 'world.checkpoint', operation: 'restore', target: { kind: 'world' } })
        .allowed,
    ).toBe(false);
  });
});
