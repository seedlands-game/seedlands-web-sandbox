import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import type { FrozenGameSaveSnapshot } from '../../../../../../../packages/stdlib/src/server/persistence/game-save-snapshot';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { createClassicComposition } from '../../../../fixtures/classic/content';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';

type Capture = { sourceSha: string; fixtureFile: string; rawSha256: string; gzipSha256: string };
const directory = new URL('../../../../fixtures/checkpoints/pre-storage-production/', import.meta.url);
const captures = JSON.parse(readFileSync(new URL('captures.json', directory), 'utf8')) as Capture[];
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function capturedSnapshot(capture: Capture): FrozenGameSaveSnapshot {
  const compressed = readFileSync(new URL(capture.fixtureFile, directory));
  expect(sha256(compressed)).toBe(capture.gzipSha256);
  const raw = gunzipSync(compressed);
  expect(sha256(raw)).toBe(capture.rawSha256);
  const snapshot = JSON.parse(raw.toString('utf8')) as FrozenGameSaveSnapshot;
  // Original JSON captures contain indexed typed-array data. Rehydrate only the V1 chunk byte fields.
  const arrayValues = (value: unknown, maximum: number) => {
    const data = value as Record<string, number>;
    expect(Object.keys(data)).toEqual(Array.from({ length: CHUNK_SIZE ** 3 }, (_, index) => String(index)));
    const values = Object.values(data);
    expect(values.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= maximum)).toBe(true);
    return values;
  };
  return {
    ...snapshot,
    chunks: snapshot.chunks.map((chunk) => ({
      ...chunk,
      voxels: Uint16Array.from(arrayValues(chunk.voxels, 65535)),
      fluid: chunk.fluid === undefined ? undefined : Uint8Array.from(arrayValues(chunk.fluid, 255)),
    })),
  };
}

it.each(captures)(
  'restores exact full production checkpoint $sourceSha through the normal world owner',
  async (capture) => {
    const snapshot = capturedSnapshot(capture);
    const session = await HeadlessSession.create({
      seedText: 'legacy-portable-target',
      platform: testCorePlatform,
      createComposition: createClassicComposition,
    });
    try {
      const oldOwner = session.runtime;
      const result = await session.world.checkpoint({ kind: 'restore', snapshot });
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      expect(session.runtime).not.toBe(oldOwner);
      expect(session.runtime.snapshot().paused).toBe(true);
      const restored = session.runtime.exportPortableCheckpoint();
      expect(restored.seedText).toBe(snapshot.seedText);
      expect(restored.generatorVersion).toBe(snapshot.generatorVersion);
      expect(restored.worldRevision).toBe(snapshot.worldRevision);
      expect(restored.chunks).toEqual(snapshot.chunks);
      expect(restored.gameplay.entityStore).toEqual(snapshot.gameplay.entityStore);
      expect(restored.gameplay.gameplayTime).toBe(snapshot.gameplay.gameplayTime);
      expect(restored.gameplay.worldTime).toBe(snapshot.gameplay.worldTime);
      expect(restored.gameplay.moduleSchedule).toEqual(snapshot.gameplay.moduleSchedule);
      expect(restored.gameplay.authoritySession).toEqual({ ...snapshot.gameplay.authoritySession, paused: true });
      expect(session.runtime.view().transports).toHaveLength(2);
      for (const transport of session.runtime.view().transports!) expect(transport.reference.epoch).toBe(2);
    } finally {
      await session.dispose();
    }
  },
);

it.each(['manifest', 'resource'] as const)(
  'rejects an undeclared %s identity without replacing or writing the live owner',
  async (field) => {
    const snapshot = capturedSnapshot(captures[0]!);
    const identity = snapshot.gameplay.composition;
    if (!identity) throw new Error('Captured production composition is missing.');
    const tampered = {
      ...snapshot,
      gameplay: {
        ...snapshot.gameplay,
        composition: {
          ...identity,
          packLock: identity.packLock.map((entry, index) =>
            index
              ? entry
              : {
                  ...entry,
                  integrity: {
                    ...entry.integrity!,
                    ...(field === 'manifest'
                      ? { manifestDigest: 'f'.repeat(64) }
                      : {
                          resources: entry.integrity!.resources.map((resource, resourceIndex) =>
                            resourceIndex ? resource : { ...resource, digest: 'f'.repeat(64) },
                          ),
                        }),
                  },
                },
          ),
        },
      },
    };
    const session = await HeadlessSession.create({
      seedText: 'unchanged-portable-owner',
      platform: testCorePlatform,
      createComposition: createClassicComposition,
    });
    try {
      const owner = session.runtime,
        before = owner.exportPortableCheckpoint();
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: tampered })).toMatchObject({ ok: false });
      expect(session.runtime).toBe(owner);
      expect(session.runtime.exportPortableCheckpoint()).toEqual(before);
    } finally {
      await session.dispose();
    }
  },
);
