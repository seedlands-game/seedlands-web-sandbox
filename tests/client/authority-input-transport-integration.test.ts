import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collider, PhysicsWorld, WorldAabb } from '../../src/physics';
import { PROTOCOL_VERSION, InputCommandBuffer, type InputCommand } from '../../src/runtime/session-protocol';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session';
import type { WorldCommitResult } from '../../src/server/game-server-types';
import type { AuthorityReady, AuthorityResponse } from '../../src/worker/authority-worker-protocol';
import { BrowserAuthorityClient } from '../../src/client/authority/browser-authority-client';
import { createAuthorityTransport, type AuthorityTransportPort } from '../../src/client/authority/authority-transport';
import { LocalPlayerPrediction } from '../../src/client/local-player-prediction';

const PHYSICS_HZ = 120;
const START_TICK = 100;

const body = () => ({
  id: 'player-1',
  type: 'player' as const,
  body: { position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  grounded: false,
  contacts: [],
});

const snapshotAt = (
  physicsTick: number,
  worldRevision: number,
  acknowledgedInputSequence = -1,
  inputResyncRequired = false,
): AuthoritySnapshot => {
  const player = body();
  return {
    kind: 'snapshot',
    protocolVersion: PROTOCOL_VERSION,
    epoch: 'world:1',
    physicsTick,
    commitSequence: physicsTick,
    acknowledgedInputSequence,
    inputResyncRequired,
    activeTimeMs: (physicsTick * 1_000) / PHYSICS_HZ,
    integratedPhysicsTimeMs: (physicsTick * 1_000) / PHYSICS_HZ,
    physicsDebtMs: 0,
    player,
    entities: [player],
    chunkRevisions: { '0,0,0': worldRevision },
    worldRevision,
    worldMutationCount: worldRevision,
    worldTime: 9,
    paused: false,
  };
};

const semanticCommit = (worldRevision: number): WorldCommitResult => ({
  committed: true,
  worldRevision,
  structuralChange: null,
  semanticEvents: [],
  metrics: {
    timingStatus: 'measured',
    inputMutationCount: 0,
    canonicalWriteCount: 0,
    dirtyChunkCount: 0,
    meshInvalidationCount: 0,
    structuralEventCount: 0,
    semanticEventCount: 0,
    mutationPayloadBytes: 0,
    mutationCapacityBytes: 0,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});

class RevisionWorld implements PhysicsWorld {
  revision = 1;
  querySolids(_bounds: WorldAabb): readonly Collider[] {
    return [];
  }
  revisionVector(): Readonly<Record<string, number>> {
    return { '0,0,0': this.revision };
  }
}

class AuthorityInputPort implements AuthorityTransportPort<AuthorityResponse> {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly input = new InputCommandBuffer('world:1', 'player-input');
  readonly decisions: string[] = [];
  onStart: (() => void) | null = null;
  terminated = false;

  postMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    if ((message as { kind?: string }).kind === 'start-authority') {
      this.onStart?.();
      return;
    }
    if ((message as { kind?: string }).kind !== 'input') return;
    const command = message as InputCommand;
    this.input.consumeForTick(this.physicsTick());
    const decision = this.input.push(command);
    this.decisions.push(decision);
    this.emit({
      kind: 'input-decision',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      sequence: command.sequence,
      decision,
      requiresResync: this.input.requiresResync,
    });
  }

  emitSnapshot(worldRevision: number): void {
    const physicsTick = this.physicsTick();
    const consumed = this.input.consumeForTick(physicsTick);
    this.emit({
      kind: 'authority-snapshot',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      snapshot: snapshotAt(physicsTick, worldRevision, consumed.acknowledgedSequence, this.input.requiresResync),
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  private physicsTick(): number {
    return START_TICK + Math.floor((Date.now() * PHYSICS_HZ) / 1_000);
  }

  emit(message: AuthorityResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<AuthorityResponse>);
  }
}

afterEach(() => vi.useRealTimers());

describe('Authority 输入故障传输接线', () => {
  it('首个运动快照越过ready时仍完成握手，且迟到结构提交独立发布', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const faults = {
      harnessEnabled: true,
      latencyMs: 150 as const,
      duplicateInbound: true,
      reorderInbound: true,
    };
    const raw = new AuthorityInputPort();
    const commits: number[] = [];
    const client = new BrowserAuthorityClient(createAuthorityTransport(raw, faults), 'world:1', {
      transportFaults: faults,
      requestTimeoutMs: 1_000,
      onCommit: (commit) => commits.push(commit.worldRevision),
    });
    const ready = {
      playerId: 'player-1',
      playerBodyPosition: [0, 5, 0],
      isNew: false,
      seed: 1,
      seedText: 'saved',
      generatorVersion: 3,
      worldTime: 9,
      frequencies: { physicsHz: 120, gameplayHz: 20, fluidHz: 30 },
      snapshot: snapshotAt(0, 0),
      gameplay: {},
    } as AuthorityReady;
    const starting = client.start({
      seedText: 'saved',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies: ready.frequencies,
    });
    vi.advanceTimersByTime(150);
    raw.emit({ kind: 'authority-ready', protocolVersion: PROTOCOL_VERSION, epoch: 'world:1', ready });
    vi.advanceTimersByTime(8);
    raw.emit({
      kind: 'authority-snapshot',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      snapshot: snapshotAt(1, 2),
    });
    vi.advanceTimersByTime(42);
    raw.emit({
      kind: 'authority-commits',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      commits: [semanticCommit(1)],
    });
    raw.emit({
      kind: 'authority-commits',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      commits: [semanticCommit(2)],
    });
    raw.emit({
      kind: 'authority-commits',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'old',
      commits: [semanticCommit(3)],
    });
    vi.advanceTimersByTime(210);

    expect(client.snapshot?.physicsTick).toBe(1);
    expect(client.snapshot?.worldRevision).toBe(2);
    expect(client.isReady).toBe(true);
    await expect(starting).resolves.toStrictEqual(ready);
    expect([...commits].sort()).toEqual([1, 2]);
    client.dispose();
  });

  it('ready乱序握手后经多轮150ms重复传输和碰撞历史重置仍只接纳有效输入', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const faults = {
      harnessEnabled: true,
      latencyMs: 150 as const,
      duplicateOutbound: true,
      duplicateInbound: true,
      reorderInbound: true,
    };
    const raw = new AuthorityInputPort();
    const decisions: Array<Readonly<{ decision: string; requiresResync: boolean }>> = [];
    let prediction: LocalPlayerPrediction | null = null;
    let latestSnapshot: AuthoritySnapshot | null = null;
    let initialPredictionTick = -1;
    let serverRevision = 1;
    const world = new RevisionWorld();
    const client = new BrowserAuthorityClient(createAuthorityTransport(raw, faults), 'world:1', {
      transportFaults: faults,
      onInputDecision: (decision) => {
        decisions.push(decision);
        const activePrediction = prediction;
        if (activePrediction && latestSnapshot && decision.requiresResync)
          activePrediction.resynchronize(latestSnapshot);
      },
      onSnapshot: (snapshot) => {
        latestSnapshot = snapshot;
        const activePrediction = prediction;
        if (!activePrediction) return;
        activePrediction.applyAuthoritySnapshot(snapshot, world);
        const commands = activePrediction.advance({
          elapsedSeconds: 1 / 60,
          snapshot,
          world,
          issuedAtMs: Date.now(),
          forward: { x: 0, z: -1 },
          right: { x: 1, z: 0 },
          keys: { forward: true, back: false, left: false, right: false, jump: false, crouch: false },
        }).commands;
        commands.forEach((command) => client.sendInput(command));
      },
      onCommit: (commit) => {
        world.revision = commit.worldRevision;
      },
    });
    const ready = {
      playerId: 'player-1',
      playerBodyPosition: [0, 5, 0],
      isNew: false,
      seed: 1,
      seedText: 'saved',
      generatorVersion: 3,
      worldTime: 9,
      frequencies: { physicsHz: 120, gameplayHz: 20, fluidHz: 30 },
      snapshot: snapshotAt(100, 1),
      gameplay: {},
    } as AuthorityReady;
    raw.onStart = () => {
      raw.emit({ kind: 'authority-ready', protocolVersion: PROTOCOL_VERSION, epoch: 'world:1', ready });
      for (let cycle = 0; cycle < 80; cycle += 1)
        setTimeout(() => raw.emitSnapshot(serverRevision), 8 + (cycle * 1_000) / 60);
      setTimeout(() => {
        serverRevision = 2;
        raw.emit({
          kind: 'authority-commits',
          protocolVersion: PROTOCOL_VERSION,
          epoch: 'world:1',
          commits: [semanticCommit(serverRevision)],
        });
      }, 350);
    };
    const starting = client.start({
      seedText: 'saved',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies: ready.frequencies,
    });
    void starting.then((resolved) => {
      latestSnapshot = client.snapshot ?? resolved.snapshot;
      initialPredictionTick = latestSnapshot.physicsTick;
      prediction = new LocalPlayerPrediction('world:1', PHYSICS_HZ, {
        estimatedInputTransitMs: client.estimatedInputTransitMs,
      });
      prediction.applyAuthoritySnapshot(latestSnapshot, world);
    });

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(starting).resolves.toStrictEqual(ready);

    expect(initialPredictionTick).toBeGreaterThan(ready.snapshot.physicsTick);
    expect(
      raw.decisions.filter((decision) =>
        ['invalid', 'late', 'target-out-of-order', 'too-far-ahead', 'capacity'].includes(decision),
      ),
    ).toEqual([]);
    expect(raw.decisions).toContain('out-of-order');
    expect(raw.decisions.filter((decision) => decision === 'accepted').length).toBeGreaterThan(20);
    expect(raw.input.requiresResync).toBe(false);
    expect(
      decisions.every(
        ({ decision, requiresResync }) => !requiresResync && ['accepted', 'duplicate'].includes(decision),
      ),
    ).toBe(true);
    const finalPrediction = prediction as LocalPlayerPrediction | null;
    expect(finalPrediction?.resetCounts['collision-history-missing'] ?? 0).toBeGreaterThan(0);
    expect(finalPrediction?.resetCounts['authority-resync'] ?? 0).toBe(0);
    client.dispose();
    expect(raw.terminated).toBe(true);
  });
});
