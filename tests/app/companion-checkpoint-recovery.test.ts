import { afterEach, expect, it, vi } from 'vitest';
import { HeadlessSession } from '@seedlands/game-core/server/headless/headless-session';
import { testCorePlatform } from '../support/core-platform';
import { CompanionSession } from '../../apps/web/src/app/gameplay/companion/companion-session';
import {
  captureApplicationCheckpoint,
  encodeApplicationCheckpoint,
} from '../../apps/web/src/client/persistence/application-checkpoint';
import { CognitionTimeline } from '../../apps/web/src/client/persistence/cognition-timeline';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';

const createComposition = () =>
  assembleOverworldPacks([
    {
      ...overworld,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);

const controls = vi.hoisted(() => ({
  failImport: true,
  importCalls: 0,
  connects: [] as { worldId: string; timelineId: string }[],
  pausedStates: [] as boolean[],
}));
vi.mock('../../apps/web/src/client/character/resident-checkpoint-transfer', async (load) => ({
  ...(await load<typeof import('../../apps/web/src/client/character/resident-checkpoint-transfer')>()),
  importResidentCheckpoint: async () => {
    controls.importCalls++;
    if (controls.failImport) throw new Error('PG unavailable during restore');
  },
}));
vi.mock('../../apps/web/src/client/character/resident-bridge', () => ({
  ResidentBridge: class {
    constructor(private options: { onConnection(phase: string, message: string): void }) {}
    connect(_url: string, _token: string, binding: { worldId: string; timelineId: string }) {
      controls.connects.push(binding);
      this.options.onConnection('ready', 'ready');
    }
    async whenReady() {}
    disconnect() {
      this.options.onConnection('disconnected', 'disconnected');
    }
    setPaused(paused: boolean) {
      controls.pausedStates.push(paused);
    }
  },
}));
afterEach(() => vi.unstubAllGlobals());

const residentCheckpoint = (worldId: string, timelineId: string, marker = 'saved') =>
  JSON.stringify({
    format: 'seedlands-resident-cognition',
    version: 1,
    source: { worldId, timelineId, epoch: `epoch-${marker}` },
    workspaces: [],
  });

it('marks the restored seed before Authority mutation and survives failed PG import and UI recreation', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal('localStorage', storage);
  controls.connects.length = 0;
  controls.importCalls = 0;
  controls.failImport = true;
  controls.pausedStates.length = 0;
  const a = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'saved-seed-a',
    createComposition,
  });
  const b = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'current-seed-b',
    createComposition,
  });
  const timeline = new CognitionTimeline(storage);
  const target = `seedlands:g${a.runtime.server.generatorVersion}:saved-seed-a`;
  const checkpoint = await captureApplicationCheckpoint(
    a.world,
    async () => residentCheckpoint(target, 'past'),
    'past',
  );
  const previous = `seedlands:g${b.runtime.server.generatorVersion}:current-seed-b`;
  const file = new File([encodeApplicationCheckpoint(checkpoint)], 'world.json');
  let session: CompanionSession;
  const world = new Proxy(b.world, {
    get(port, property) {
      if (property === 'checkpoint')
        return async (request: Parameters<typeof b.world.checkpoint>[0]) => {
          expect(timeline.requiresRestore(target)).toBe(true);
          const result = await port.checkpoint(request);
          if (result.ok) session.worldRestored(target); // Actual Game callback occurs before promise resolution.
          return result;
        };
      return Reflect.get(port, property);
    },
  });
  const authority = {
    world,
    character: (request: Parameters<typeof b.world.character>[0]) => b.world.character(request),
    bindCharacter: async () => {
      throw new Error('no active characters');
    },
  };
  try {
    session = new CompanionSession(
      () => authority,
      () => true,
    );
    await session.connect('ws://localhost:8787', 'fake-pair');
    expect(session.get().error).toBe('');
    await session.importCheckpoint(file);
    expect(session.get().error).not.toBe('');
    expect(timeline.requiresRestore(target)).toBe(true);
    expect(timeline.requiresRestore(previous)).toBe(false);
    expect(controls.importCalls).toBe(1);
    const restoredIdentity = await b.world.identity();
    expect(restoredIdentity).toMatchObject({ ok: true, data: { worldId: target } });
    const fork = timeline.current(target);
    session.stop();
    session = new CompanionSession(
      () => authority,
      () => true,
    );
    await session.connect('ws://localhost:8787', 'fake-pair');
    expect(session.get().notice).toContain('上次伙伴记忆尚未恢复');
    expect(timeline.current(target)).toBe(fork);
    expect(controls.importCalls).toBe(1);
    controls.failImport = false;
    await session.importCheckpoint(file);
    expect(timeline.requiresRestore(target)).toBe(false);
    expect(session.get().notice).toContain('世界与伙伴记忆已恢复');
  } finally {
    await a.dispose();
    await b.dispose();
  }
}, 30000);

it('rejects a swapped application pair before pausing, restoring the world or reserving cognition restore', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  controls.importCalls = 0;
  controls.pausedStates.length = 0;
  const world = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'application-swap-guard' });
  const sourceWorldId = `seedlands:g${world.runtime.server.generatorVersion}:application-swap-guard`;
  try {
    const first = await captureApplicationCheckpoint(
      world.world,
      async () => residentCheckpoint(sourceWorldId, 'same-timeline', 'first'),
      'same-timeline',
    );
    const second = await captureApplicationCheckpoint(
      world.world,
      async () => residentCheckpoint(sourceWorldId, 'same-timeline', 'second'),
      'same-timeline',
    );
    const checkpoint = vi.fn((request: Parameters<typeof world.world.checkpoint>[0]) =>
      world.world.checkpoint(request),
    );
    const clock = vi.fn((request: Parameters<typeof world.world.clock>[0]) => world.world.clock(request));
    const authority = {
      world: new Proxy(world.world, {
        get(port, property) {
          if (property === 'checkpoint') return checkpoint;
          if (property === 'clock') return clock;
          return Reflect.get(port, property);
        },
      }),
      character: (request: Parameters<typeof world.world.character>[0]) => world.world.character(request),
      bindCharacter: async () => {
        throw new Error('no active characters');
      },
    };
    const session = new CompanionSession(
      () => authority,
      () => false,
    );
    const before = await world.world.identity();
    const swapped = encodeApplicationCheckpoint({
      ...first,
      cognition: second.cognition,
      cognitionHash: second.cognitionHash,
    });
    await session.importCheckpoint(new File([swapped], 'swapped.json'));
    expect(session.get().error).toContain('配对校验失败');
    const legacy = { ...first, version: 1 };
    delete (legacy as Partial<Record<'pairHash', unknown>>).pairHash;
    await session.importCheckpoint(new File([JSON.stringify(legacy)], 'legacy-v1.json'));
    expect(session.get().error).toContain('版本不受支持');
    expect(clock).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
    expect(controls.importCalls).toBe(0);
    expect(controls.pausedStates).toEqual([]);
    expect(values.size).toBe(0);
    expect(await world.world.identity()).toEqual(before);
  } finally {
    await world.dispose();
  }
}, 15000);

it('restores the local pause state when export is rejected or import disconnects during authority pause', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  controls.pausedStates.length = 0;
  const world = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'checkpoint-pause-failure' });
  try {
    const application = await captureApplicationCheckpoint(world.world, null, null);
    let mode: 'rejected' | 'disconnected' = 'rejected';
    let restoreCalls = 0;
    const authorityWorld = new Proxy(world.world, {
      get(port, property) {
        if (property === 'clock')
          return async (request: Parameters<typeof world.world.clock>[0]) => {
            if (request.kind !== 'pause') return world.world.clock(request);
            if (mode === 'disconnected') throw new Error('authority disconnected');
            return { ok: false, error: { code: 'WORLD_REQUEST_INVALID', message: 'pause rejected' } };
          };
        if (property === 'checkpoint')
          return async (request: Parameters<typeof world.world.checkpoint>[0]) => {
            if (request.kind === 'restore') restoreCalls++;
            return world.world.checkpoint(request);
          };
        return Reflect.get(port, property);
      },
    });
    const changes: boolean[] = [];
    const session = new CompanionSession(
      () => ({
        world: authorityWorld,
        character: (request) => world.world.character(request),
        bindCharacter: async () => {
          throw new Error('no active characters');
        },
      }),
      () => false,
      (paused) => changes.push(paused),
    );
    await session.exportCheckpoint();
    mode = 'disconnected';
    await session.importCheckpoint(new File([encodeApplicationCheckpoint(application)], 'world.json'));
    expect(changes).toEqual([true, false, true, false]);
    expect(controls.pausedStates).toEqual([false, false]);
    expect(restoreCalls).toBe(0);
    const status = await world.world.clock({ kind: 'status' });
    expect(status.ok && status.data.paused).toBe(false);
  } finally {
    await world.dispose();
  }
}, 15000);

it('clears a newly reserved cognition restore when the world restore promise rejects', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal('localStorage', storage);
  controls.importCalls = 0;
  controls.pausedStates.length = 0;
  const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'restore-reject-source' });
  const current = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'restore-reject-current',
    createComposition,
  });
  const targetWorldId = `seedlands:g${source.runtime.server.generatorVersion}:restore-reject-source`;
  try {
    const application = await captureApplicationCheckpoint(
      source.world,
      async () => residentCheckpoint(targetWorldId, 'source-timeline'),
      'source-timeline',
    );
    const authorityWorld = new Proxy(current.world, {
      get(port, property) {
        if (property === 'checkpoint')
          return async (request: Parameters<typeof current.world.checkpoint>[0]) => {
            if (request.kind === 'restore') throw new Error('authority disconnected during restore');
            return current.world.checkpoint(request);
          };
        return Reflect.get(port, property);
      },
    });
    const changes: boolean[] = [];
    const session = new CompanionSession(
      () => ({
        world: authorityWorld,
        character: (request) => current.world.character(request),
        bindCharacter: async () => {
          throw new Error('no active characters');
        },
      }),
      () => false,
      (paused) => changes.push(paused),
    );
    await session.connect('ws://localhost:8787', 'fake-pair');
    const before = await current.world.identity();
    await session.importCheckpoint(new File([encodeApplicationCheckpoint(application)], 'world.json'));
    expect(session.get().error).not.toBe('');
    expect(new CognitionTimeline(storage).requiresRestore(targetWorldId)).toBe(false);
    expect(controls.importCalls).toBe(0);
    expect(controls.pausedStates).toEqual([true, false]);
    expect(changes).toEqual([true, false]);
    expect(await current.world.identity()).toEqual(before);
    const status = await current.world.clock({ kind: 'status' });
    expect(status.ok && status.data.paused).toBe(false);
  } finally {
    await source.dispose();
    await current.dispose();
  }
}, 15000);
