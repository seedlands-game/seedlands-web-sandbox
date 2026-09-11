import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/stdlib/server/headless/headless-session';
import { WorldResourceAuthorizer } from '@seedlands/stdlib/server/harness/world-authorization';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import {
  captureApplicationCheckpoint,
  decodeApplicationCheckpoint,
  encodeApplicationCheckpoint,
} from '../../../../src/client/persistence/application-checkpoint';
import { browserWorldOwnerPolicy } from '../../../../src/worker/authority-worker-world-policy';
import { createClassicComposition } from '../../../fixtures/classic/content';

const worldId = (snapshot: { generatorVersion: number; seedText: string }) =>
  `seedlands:g${snapshot.generatorVersion}:${snapshot.seedText}`;
const cognition = (snapshot: { generatorVersion: number; seedText: string }, timelineId: string, marker: string) =>
  JSON.stringify({
    format: 'seedlands-resident-cognition',
    version: 1,
    source: { worldId: worldId(snapshot), timelineId, epoch: `epoch-${marker}` },
    workspaces: [],
  });
const createWorld = (seedText: string) =>
  HeadlessSession.create({ platform: testCorePlatform, seedText, createComposition: createClassicComposition });

describe('application checkpoint ownership', () => {
  it('pairs a real world snapshot with cognition and rejects tampering before restore', async () => {
    const session = await createWorld('application-checkpoint');
    try {
      await session.world.clock({ kind: 'pause' });
      const exported = await session.world.checkpoint({ kind: 'export' });
      if (!exported.ok || !exported.data.snapshot) throw new Error('World export failed');
      const checkpoint = await captureApplicationCheckpoint(
        session.world,
        async () => cognition(exported.data.snapshot!, 'timeline-yesterday', 'yesterday'),
        'timeline-yesterday',
      );
      const decoded = await decodeApplicationCheckpoint(encodeApplicationCheckpoint(checkpoint));
      expect(decoded.version).toBe(2);
      expect(decoded.pairHash).toMatch(/^[a-f0-9]{64}$/u);
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

  it('binds real world identities, resident sources and same-timeline save moments as one tuple', async () => {
    const firstWorld = await createWorld('application-pair-a');
    const secondWorld = await createWorld('application-pair-b');
    try {
      await firstWorld.world.clock({ kind: 'pause' });
      await secondWorld.world.clock({ kind: 'pause' });
      const firstExport = await firstWorld.world.checkpoint({ kind: 'export' });
      const secondExport = await secondWorld.world.checkpoint({ kind: 'export' });
      if (!firstExport.ok || !firstExport.data.snapshot || !secondExport.ok || !secondExport.data.snapshot)
        throw new Error('World export failed');
      const first = await captureApplicationCheckpoint(
        firstWorld.world,
        async () => cognition(firstExport.data.snapshot!, 'shared-timeline', 'first'),
        'shared-timeline',
      );
      const otherWorld = await captureApplicationCheckpoint(
        secondWorld.world,
        async () => cognition(secondExport.data.snapshot!, 'other-world-timeline', 'other-world'),
        'other-world-timeline',
      );
      await expect(decodeApplicationCheckpoint(encodeApplicationCheckpoint(first))).resolves.toEqual(first);
      await expect(decodeApplicationCheckpoint(encodeApplicationCheckpoint(otherWorld))).resolves.toEqual(otherWorld);

      await firstWorld.world.clock({ kind: 'advance', elapsedMs: 1000 });
      const secondMoment = await captureApplicationCheckpoint(
        firstWorld.world,
        async () => cognition(firstExport.data.snapshot!, 'shared-timeline', 'second'),
        'shared-timeline',
      );
      expect(secondMoment.worldHash).not.toBe(first.worldHash);
      await expect(
        decodeApplicationCheckpoint(
          encodeApplicationCheckpoint({
            ...first,
            cognition: secondMoment.cognition,
            cognitionHash: secondMoment.cognitionHash,
          }),
        ),
      ).rejects.toThrow('配对校验失败');

      const otherTimeline = await captureApplicationCheckpoint(
        firstWorld.world,
        async () => cognition(firstExport.data.snapshot!, 'different-timeline', 'different-timeline'),
        'different-timeline',
      );
      await expect(
        decodeApplicationCheckpoint(
          encodeApplicationCheckpoint({
            ...first,
            cognition: otherTimeline.cognition,
            cognitionHash: otherTimeline.cognitionHash,
          }),
        ),
      ).rejects.toThrow('时间线不匹配');
      await expect(
        decodeApplicationCheckpoint(
          encodeApplicationCheckpoint({
            ...first,
            cognition: otherWorld.cognition,
            cognitionHash: otherWorld.cognitionHash,
            sourceTimeline: otherWorld.sourceTimeline,
          }),
        ),
      ).rejects.toThrow('世界不匹配');
    } finally {
      await firstWorld.dispose();
      await secondWorld.dispose();
    }
  }, 20000);

  it('rejects unpaired nulls, unknown resident sources and application v1', async () => {
    const session = await createWorld('application-invalid-pair');
    try {
      await session.world.clock({ kind: 'pause' });
      const exported = await session.world.checkpoint({ kind: 'export' });
      if (!exported.ok || !exported.data.snapshot) throw new Error('World export failed');
      await expect(captureApplicationCheckpoint(session.world, null, 'orphan-timeline')).rejects.toThrow(
        '认知存档清单不一致',
      );
      await expect(
        captureApplicationCheckpoint(
          session.world,
          async () => cognition(exported.data.snapshot!, 'orphan', 'orphan'),
          null,
        ),
      ).rejects.toThrow('认知存档清单不一致');
      await expect(
        captureApplicationCheckpoint(session.world, async () => JSON.stringify({ source: 'unknown' }), 'timeline'),
      ).rejects.toThrow('认知存档清单无效');
      const checkpoint = await captureApplicationCheckpoint(session.world, null, null);
      await expect(
        decodeApplicationCheckpoint(encodeApplicationCheckpoint({ ...checkpoint, sourceTimeline: 'orphan' })),
      ).rejects.toThrow('认知存档清单不一致');
      await expect(
        decodeApplicationCheckpoint(encodeApplicationCheckpoint({ ...checkpoint, cognitionHash: '0'.repeat(64) })),
      ).rejects.toThrow('认知存档清单不一致');
      const paired = await captureApplicationCheckpoint(
        session.world,
        async () => cognition(exported.data.snapshot!, 'paired', 'paired'),
        'paired',
      );
      await expect(
        decodeApplicationCheckpoint(encodeApplicationCheckpoint({ ...paired, sourceTimeline: null })),
      ).rejects.toThrow('认知存档清单不一致');
      await expect(
        decodeApplicationCheckpoint(encodeApplicationCheckpoint({ ...paired, cognitionHash: null })),
      ).rejects.toThrow('认知存档清单不一致');
      const legacy = { ...checkpoint, version: 1 };
      delete (legacy as Partial<Record<'pairHash', unknown>>).pairHash;
      await expect(decodeApplicationCheckpoint(encodeApplicationCheckpoint(legacy as never))).rejects.toThrow(
        '应用存档版本不受支持',
      );
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
