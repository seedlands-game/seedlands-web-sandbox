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
    setPaused() {}
  },
}));
afterEach(() => vi.unstubAllGlobals());

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
  const checkpoint = await captureApplicationCheckpoint(a.world, async () => 'bounded cognition fixture', 'past');
  const target = `seedlands:g${checkpoint.world.generatorVersion}:saved-seed-a`;
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
