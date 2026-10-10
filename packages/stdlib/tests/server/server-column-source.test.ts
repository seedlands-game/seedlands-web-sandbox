import { describe, expect, it, vi } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';
import { inspectServerColumnSource } from '../../src/server/server-column-source';
import type { ServerChunk } from '../../src/server/game-server-types';

const make = (bound: ((input: { x: number; z: number }) => number | null) | null = () => 51) => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const provider = { ...testWorldgenExecutableProvider, ...(bound ? { generatedEmptyAboveY: bound } : {}) };
  const server = new GameServer({
    seedText: 'column-source',
    platform: testCorePlatform,
    persistence,
    worldgenProvider: provider,
  });
  return { server, persistence, provider };
};

describe('GameServer authoritative column source observation', () => {
  it.each([
    null,
    { status: 'complete', revision: 0, entries: null },
    { status: 'complete', revision: 0, entries: [null] },
    { status: 'unknown', reason: 'wrong' },
  ])('malformed optional directory response stays unknown: %o', async (reply) => {
    const { server, persistence } = make();
    vi.spyOn(persistence, 'inspectColumnDirectory').mockResolvedValue(reply as never);
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'invalid-data' });
  });
  it.each([NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])('invalid producer bound %s remains unknown', async (bound) => {
    expect(await make(() => bound).server.inspectColumnSource(0, 0)).toEqual({
      status: 'unknown',
      reason: 'invalid-data',
    });
  });
  it('negative generated bounds remain legal and unsupported versions do not call the producer', async () => {
    expect(await make(() => -100).server.inspectColumnSource(0, 0)).toMatchObject({ generatedEmptyAboveY: -100 });
    const bound = vi.fn(() => 51);
    const { server, provider } = make(bound);
    provider.identity = { ...provider.identity, supportedGeneratorVersions: [2] };
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'source-unavailable' });
    expect(bound).not.toHaveBeenCalled();
  });
  it('directory unknown and a newer persisted revision cannot be hidden by residency', async () => {
    const { server, persistence } = make();
    server.getChunk(0, 0, 0);
    persistence.saveSnapshots([
      {
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        revision: 1,
        seedText: 'column-source',
        generatorVersion: 11,
        voxels: new Uint16Array(32768),
      },
    ]);
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'invalid-data' });
    vi.spyOn(persistence, 'inspectColumnDirectory').mockResolvedValue({
      status: 'unknown',
      reason: 'budget-exhausted',
    });
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
  });
  it('merged overflow and damaged resident metadata never yield partial completeness', async () => {
    const { server, persistence } = make();
    persistence.saveSnapshots(
      Array.from({ length: 128 }, (_, cy) => ({
        key: `0,${cy},0`,
        cx: 0,
        cy,
        cz: 0,
        revision: 0,
        seedText: 'column-source',
        generatorVersion: 11,
        voxels: new Uint16Array(32768),
      })),
    );
    server.getChunk(0, 128, 0);
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
    server.getChunk(0, 128, 0).revision = NaN;
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'invalid-data' });
  });
  it('unsafe voxel coordinates and throwing guarantees remain unknown', async () => {
    const { server } = make();
    expect(await server.inspectColumnSource(Number.MAX_SAFE_INTEGER, 0)).toEqual({
      status: 'unknown',
      reason: 'invalid-data',
    });
    const throwing = make(() => {
      throw new Error('bound unavailable');
    });
    expect(await throwing.server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'invalid-data' });
  });
  it.each([128, 129, 1025])('bounds resident metadata visits and merged keys at count %s', async (count) => {
    const { persistence, provider } = make();
    const records = new Map<string, ServerChunk>();
    for (let i = 0; i < count; i++) {
      const cx = count === 1025 ? i : 0,
        cy = count === 1025 ? 0 : i;
      const key = `${cx},${cy},0`;
      records.set(key, {
        key,
        cx,
        cy,
        cz: 0,
        revision: 0,
        persistedRevision: 0,
        dirty: false,
        materialized: false,
        accessEpoch: 0,
        voxels: new Uint16Array(),
        fluid: new Uint8Array(),
      });
    }
    const directory = vi.spyOn(persistence, 'inspectColumnDirectory');
    const result = await inspectServerColumnSource(
      {
        seed: 1,
        generatorVersion: 11,
        provider,
        persistence,
        state: () => ({ epoch: 1, worldRevision: 0, chunks: records }),
      },
      0,
      0,
    );
    if (count === 128) {
      expect(result.status).toBe('complete');
      if (result.status !== 'complete') throw new Error('Expected complete');
      expect(result.entries).toHaveLength(128);
    } else {
      expect(result).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
      expect(directory).not.toHaveBeenCalled();
    }
  });
  it('aggregates the real producer bounds without materializing or consuming snapshots', async () => {
    const bound = vi.fn(({ x, z }: { x: number; z: number }) => x + z);
    const { server, persistence, provider } = make(bound);
    const load = vi.spyOn(persistence, 'loadSnapshot');
    const generate = vi.spyOn(provider, 'generate');
    const before = server.canonicalResidencyDiagnostics;
    expect(await server.inspectColumnSource(-2, 3)).toMatchObject({
      status: 'complete',
      generatedEmptyAboveY: 94,
      entries: [],
    });
    expect(bound).toHaveBeenCalledTimes(1024);
    expect(load).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(server.canonicalResidencyDiagnostics).toEqual(before);
  });
  it('keeps high dirty and persisted-only keys and detaches metadata', async () => {
    const { server, persistence } = make();
    server.edit(0, 320000, 0, 1);
    persistence.saveSnapshots([
      {
        key: '0,-10000,0',
        cx: 0,
        cy: -10000,
        cz: 0,
        revision: 7,
        seedText: 'column-source',
        generatorVersion: 11,
        voxels: new Uint16Array(32768),
      },
    ]);
    const value = await server.inspectColumnSource(0, 0);
    expect(value).toMatchObject({
      status: 'complete',
      entries: [
        { key: '0,-10000,0', revision: 7, resident: false, dirty: false },
        { key: '0,10000,0', revision: 1, resident: true, dirty: true },
      ],
    });
    if (value.status !== 'complete') throw new Error('Expected complete');
    Object.assign(value.entries[1], { revision: 99 });
    expect(await server.inspectColumnSource(0, 0)).toMatchObject({ entries: [{ revision: 7 }, { revision: 1 }] });
    await server.save();
    expect(await server.inspectColumnSource(0, 0)).toMatchObject({
      entries: [
        { revision: 7, resident: false },
        { revision: 1, resident: true, dirty: false },
      ],
    });
  });
  it('unknown producer or directory cannot become an empty complete source', async () => {
    expect(await make(null).server.inspectColumnSource(0, 0)).toEqual({
      status: 'unknown',
      reason: 'source-unavailable',
    });
    const { server } = make(() => null);
    expect(await server.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'source-unavailable' });
    const missing = new GameServer({
      seedText: 'column-source',
      platform: testCorePlatform,
      worldgenProvider: testWorldgenExecutableProvider,
    });
    expect(await missing.inspectColumnSource(0, 0)).toEqual({ status: 'unknown', reason: 'source-unavailable' });
    const unsupportedDirectory = new GameServer({
      seedText: 'column-source',
      platform: testCorePlatform,
      worldgenProvider: make().provider,
      persistence: { loadSnapshot: () => null, saveSnapshots: () => undefined },
    });
    expect(await unsupportedDirectory.inspectColumnSource(0, 0)).toEqual({
      status: 'unknown',
      reason: 'source-unavailable',
    });
    await expect(server.inspectColumnSource(NaN, 0)).rejects.toThrow(RangeError);
  });
  it.each(['edit', 'residency', 'restore'] as const)(
    'supersedes an asynchronous directory after %s',
    async (action) => {
      const { server, persistence } = make();
      await server.save();
      const original = persistence.inspectColumnDirectory.bind(persistence);
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      vi.spyOn(persistence, 'inspectColumnDirectory').mockImplementation(async (cx, cz) => {
        await gate;
        return original(cx, cz);
      });
      const pending = server.inspectColumnSource(0, 0);
      if (action === 'edit') server.edit(0, 60, 0, 1);
      else if (action === 'residency') server.getChunk(0, 2, 0);
      else await server.restore();
      release();
      expect(await pending).toEqual({ status: 'unknown', reason: 'superseded' });
    },
  );
});
