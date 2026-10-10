import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionSession } from '../../../src/app/gameplay/companion/companion-session';
import {
  createLifeBehavior,
  type CharacterControlRequest,
  type CharacterControlResult,
  type CharacterState,
} from '@seedlands/stdlib/runtime/character-control-protocol';
import type { WorldHarnessResult } from '@seedlands/stdlib/server/harness/world-harness-contract';
import type { BoundCharacterControlPort } from '../../../src/client/authority/browser-authority-client-contract';
import {
  LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN,
  LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN_MESSAGE,
} from '../../../src/client/persistence/legacy-gameplay-provenance-error';
import {
  captureApplicationCheckpoint,
  encodeApplicationCheckpoint,
} from '../../../src/client/persistence/application-checkpoint';
const frontier = {
  worldId: 'w',
  epoch: 'e',
  worldRevision: 1,
  commitSequence: 0,
  physicsTick: 0,
  fluidWorkSequence: 0,
  logicObservationSequence: 0,
};
const character: CharacterState = {
  lifecycle: 'active',
  entityId: 'n',
  incarnation: 'i',
  revision: 0,
  policyRevision: 1,
  profile: { name: '阿岚', personality: '谨慎' },
  currentGoal: { revision: 0, requestId: 'create', goal: { kind: 'forage' }, status: 'active' },
  behaviorTree: {
    revision: 1,
    ...createLifeBehavior({ homePosition: [1, 2, 3], patrolPositions: [[2, 2, 3]] }),
    runtime: { cycle: 1, activeNodeIds: [], skills: [], monitors: [], milestones: [] },
  },
  behavior: 'forage',
  hunger: 60,
  inventory: [],
  memory: { revision: 0, summary: '', throughCursor: 0 },
  eventCursor: 10,
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('companion UI session lifecycle', () => {
  it('reports unknown legacy provenance and keeps the active world unchanged', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    const identity = vi.fn(async () => ({ ok: true as const, frontier, data: { worldId: 'current-world' } }));
    const checkpoint = vi.fn(async (request: { kind: string }) =>
      request.kind === 'restore'
        ? {
            ok: false as const,
            error: {
              kind: 'validation' as const,
              code: 'WORLD_RPC_INVALID',
              message: `${LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN}: missing source`,
            },
          }
        : { ok: false as const, error: { kind: 'validation' as const, code: 'UNEXPECTED', message: 'unexpected' } },
    );
    const clock = vi.fn(async () => ({ ok: true as const, frontier, data: { paused: false, snapshot: {} } }));
    const world = { identity, checkpoint, clock };
    const session = new CompanionSession(
      () => ({
        world: world as never,
        character: vi.fn(),
        bindCharacter: async () => Promise.reject(new Error('not connected')),
      }),
      () => false,
    );
    const legacyWorld = {
      version: 1,
      commitSequence: 0,
      seedText: 'legacy',
      generatorVersion: 4,
      worldRevision: 0,
      physicsSchema: { version: 1, bodyRegistryVersion: 1 },
      fluidSchema: { version: 1, encoding: 'chunk-level-source-byte' },
      gameplay: {
        version: 3,
        revision: 0,
        gameplayTime: 0,
        worldTime: 9,
        entitySequence: 0,
        entities: [],
        players: [],
        simulation: {},
        coordinateSchema: { version: 1, units: 'voxel', entityOrigin: 'body-feet-center' },
        physicsSchema: { version: 1, bodyRegistryVersion: 1 },
      },
      chunks: [],
    };
    const captured = await captureApplicationCheckpoint(
      {
        ...world,
        checkpoint: async () => ({
          ok: true as const,
          frontier,
          data: { snapshot: legacyWorld as never, byteLength: 1 },
        }),
      } as never,
      null,
      null,
    );

    await session.importCheckpoint(new File([encodeApplicationCheckpoint(captured)], 'legacy-v3.json'));

    expect(checkpoint).toHaveBeenCalledOnce();
    expect(session.get().error).toBe(LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN_MESSAGE);
    expect(await identity()).toEqual({ ok: true, frontier, data: { worldId: 'current-world' } });
    session.stop();
  });

  it('creates three default residents with distinct identity prompts and no fixed execution rule', async () => {
    const profiles: CharacterState['profile'][] = [];
    const characterRequest = vi.fn(
      async (request: CharacterControlRequest): Promise<WorldHarnessResult<CharacterControlResult>> => {
        if (request.kind !== 'create') throw new Error('unexpected fixture request');
        profiles.push(request.profile);
        return {
          ok: true,
          frontier,
          data: {
            kind: 'created',
            character: {
              ...character,
              entityId: `resident-${profiles.length}`,
              profile: request.profile,
            },
          },
        };
      },
    );
    const session = new CompanionSession(
      () => ({ character: characterRequest, bindCharacter: async () => Promise.reject(new Error('not connected')) }),
      () => false,
    );

    await session.create();
    await session.create();
    await session.create();

    expect(profiles.map((profile) => profile.name)).toEqual(['阿岚', '小满', '石川']);
    expect(new Set(profiles.map((profile) => profile.personality)).size).toBe(3);
    expect(new Set(profiles.map((profile) => profile.riskTolerance)).size).toBe(3);
    expect(characterRequest.mock.calls.every(([request]) => !('behaviorTree' in request))).toBe(true);
    session.stop();
  });

  it('retires cognition after a raw world restore without acquiring a second input pause owner', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    const changePause = vi.fn();
    const session = new CompanionSession(
      () => null,
      () => false,
      changePause,
    );
    session.worldRestored('restored-world');
    expect(changePause).not.toHaveBeenCalled();
    expect(session.get().connection.phase).toBe('disconnected');
    session.stop();
  });
  it('keeps a saved identity and requests recent events; releases a binding that arrives after world exit', async () => {
    vi.useFakeTimers();
    let bind!: (port: BoundCharacterControlPort) => void;
    const port: BoundCharacterControlPort = {
      binding: {
        sessionId: 's',
        worldId: 'w',
        epoch: 'e',
        entityId: 'n',
        incarnation: 'i',
        policyRevision: 1,
        actor: { entityId: 'n', epoch: 1, lifetime: 1 },
      },
      dispose: vi.fn(),
      capabilities: vi.fn(),
      observe: vi.fn(),
      intent: vi.fn(),
      memory: vi.fn(),
      behavior: vi.fn(),
      speak: vi.fn(),
    };
    const characterRequest = vi.fn(async () => ({
      ok: true as const,
      frontier,
      data: { kind: 'list' as const, characters: [character] },
    }));
    const session = new CompanionSession(
      () => ({ character: characterRequest, bindCharacter: () => new Promise((resolve) => (bind = resolve)) }),
      () => false,
    );
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.get().character?.entityId).toBe('n');
    expect(characterRequest).toHaveBeenCalledWith({ kind: 'observe', entityId: 'n', sinceCursor: 2 });
    const connecting = session.connect('ws://localhost:8787', 'pair');
    session.stop();
    bind(port);
    await connecting;
    expect(port.dispose).toHaveBeenCalledOnce();
    expect(session.get().character).toBeNull();
    expect(session.get().connection.phase).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(2000);
    expect(characterRequest).toHaveBeenCalledTimes(2);
  });
});
