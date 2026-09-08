import { describe, expect, it } from 'vitest';
import type { AuthoritySnapshot } from '../../packages/game-core/src/server/authority/authority-session-types';
import {
  projectChunkBaselineReference,
  projectWelcomeReference,
} from '../../packages/game-core/src/server/protocol/network-reference-bootstrap';
import { projectActionRequestReference } from '../../packages/game-core/src/server/protocol/network-action-request-reference';
import {
  projectGameplayViewReference,
  projectPlayerCorrectionReference,
  projectWorldCommitReference,
} from '../../packages/game-core/src/server/protocol/network-reference-projection';
import {
  projectInputDecisionReference,
  projectPlayerInputReference,
} from '../../packages/game-core/src/server/protocol/network-reference-input';
import { projectEntityPoseReference } from '../../packages/game-core/src/server/protocol/network-reference-pose';
import type {
  AuthorityGameplayView,
  AuthorityReady,
} from '../../packages/game-core/src/compute/authority-worker-protocol';
import type { InputCommand } from '../../packages/game-core/src/runtime/session-protocol';

const expectPositiveZero = (value: number) => {
  expect(value).toBe(0);
  expect(Object.is(value, -0)).toBe(false);
};

const snapshot = (): AuthoritySnapshot =>
  ({
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'integer-zero',
    physicsTick: -0,
    commitSequence: -0,
    worldMutationCount: 0,
    acknowledgedInputSequence: -0,
    inputResyncRequired: false,
    activeTimeMs: 0,
    integratedPhysicsTimeMs: 0,
    physicsDebtMs: 0,
    player: {
      id: 'player',
      type: 'player',
      body: { position: { x: -0, y: 0, z: 0 }, velocity: { x: -0, y: 0, z: 0 } },
      grounded: true,
      contacts: [],
    },
    entities: [],
    chunkRevisions: { '0,0,0': -0 },
    worldRevision: -0,
    worldTime: -0,
    paused: false,
  }) as AuthoritySnapshot;

const input = (): InputCommand => ({
  kind: 'input',
  protocolVersion: 1,
  epoch: 'integer-zero',
  stream: 'player-input',
  sequence: -0,
  targetPhysicsTick: -0,
  issuedAtMs: -0,
  state: { moveX: -0, moveZ: -0, verticalIntent: -0, jumpHeld: false },
  edges: { jumpPressed: false },
});

describe('参考投影整数零', () => {
  it('把 action/input 的整数零投影为 +0，保持 f64 -0', () => {
    const action = projectActionRequestReference({ type: 'place', position: [-0, 0, 0] }, -0);
    expectPositiveZero(action.sequence);
    if (!('position' in action.action)) throw new Error('Expected a positional action.');
    expectPositiveZero(action.action.position[0]);

    const projectedInput = projectPlayerInputReference(input()).input;
    expectPositiveZero(projectedInput.sequence);
    expectPositiveZero(projectedInput.targetPhysicsTick);
    expectPositiveZero(projectedInput.state.verticalIntent);
    expect(Object.is(projectedInput.issuedAtMs, -0)).toBe(true);
    expect(Object.is(projectedInput.state.moveX, -0)).toBe(true);

    const decision = projectInputDecisionReference(input(), 'duplicate', snapshot());
    expectPositiveZero(decision.input.sequence);
    expectPositiveZero(decision.input.targetPhysicsTick);
    expectPositiveZero(decision.observedPhysicsTick);
    expectPositiveZero(decision.observedAcknowledgedInputSequence);
  });

  it('规范 correction、pose、Gameplay 与 world commit 的所有整数零，保持位置类 f64', () => {
    const correction = projectPlayerCorrectionReference(snapshot());
    expectPositiveZero(correction.physicsTick);
    expectPositiveZero(correction.commitSequence);
    expectPositiveZero(correction.worldRevision);
    expectPositiveZero(correction.acknowledgedInputSequence);
    expectPositiveZero(correction.collisionRevisions[0]!.revision);
    expect(Object.is(correction.worldTime, -0)).toBe(true);
    expect(Object.is(correction.player.position.x, -0)).toBe(true);

    const pose = projectEntityPoseReference(snapshot(), { publicationSequence: -0 });
    expectPositiveZero(pose.publicationSequence);
    expectPositiveZero(pose.physicsTick);
    expectPositiveZero(pose.commitSequence);
    expectPositiveZero(pose.worldRevision);

    const gameplay = {
      gameplayRevision: -0,
      gameplayTime: -0,
      player: {
        entityId: 'player',
        health: -0,
        maxHealth: 20,
        hunger: -0,
        maxHunger: 20,
        lifecycle: 'alive',
        inventory: [{ itemId: 'berry', count: -0 }],
        selectedSlot: -0,
        hotbarSize: -0,
        breakAction: { position: [-0, 0, 0], voxel: -0, elapsedSeconds: -0, requiredSeconds: -0 },
      },
      entities: [{ id: 'item', type: 'world-item', position: [-0, 0, 0], stack: { itemId: 'berry', count: -0 } }],
      actors: [],
      craftableRecipeIds: [],
      metrics: {},
    } as unknown as AuthorityGameplayView;
    const view = projectGameplayViewReference(gameplay, {
      epoch: 'integer-zero',
      snapshotPhysicsTick: -0,
      snapshotCommitSequence: -0,
      snapshotWorldRevision: -0,
    });
    expectPositiveZero(view.snapshotPhysicsTick);
    expectPositiveZero(view.snapshotCommitSequence);
    expectPositiveZero(view.snapshotWorldRevision);
    expectPositiveZero(view.gameplayRevision);
    expectPositiveZero(view.player.inventory[0]!.slot);
    expectPositiveZero(view.player.inventory[0]!.count);
    expectPositiveZero(view.player.selectedSlot);
    expectPositiveZero(view.player.hotbarSize);
    expectPositiveZero(view.player.breakAction!.voxel);
    expectPositiveZero(view.entities[0]!.stack!.count);
    expect(Object.is(view.gameplayTime, -0)).toBe(true);
    expect(Object.is(view.player.breakAction!.position[0], -0)).toBe(true);
    expect(Object.is(view.entities[0]!.position[0], -0)).toBe(true);

    const commit = projectWorldCommitReference(
      {
        committed: true,
        worldRevision: -0,
        structuralChange: { chunks: ['0,0,0'], chunkRevisions: [{ key: '0,0,0', revision: -0 }] },
        collisionDelta: [
          { key: '0,0,0', previousRevision: -0, revision: -0, cells: [{ index: -0, voxel: -0, fluid: -0 }] },
        ],
      } as never,
      { epoch: 'integer-zero', publicationCommitSequenceUpperBound: -0 },
    );
    expectPositiveZero(commit.publicationCommitSequenceUpperBound);
    expectPositiveZero(commit.worldRevision);
    expectPositiveZero(commit.structuralChange!.chunkRevisions[0]!.revision);
    expectPositiveZero(commit.collisionDeltas[0]!.previousRevision);
    expectPositiveZero(commit.collisionDeltas[0]!.revision);
    expectPositiveZero(commit.collisionDeltas[0]!.cells[0]!.index);
    expectPositiveZero(commit.collisionDeltas[0]!.cells[0]!.voxel);
    expectPositiveZero(commit.collisionDeltas[0]!.cells[0]!.fluid);
  });

  it('规范 bootstrap 整数零，保持 welcome worldTime 这个 f64', async () => {
    const ready = {
      playerId: 'player',
      playerBodyPosition: [0, 0, 0],
      isNew: false,
      seed: -0,
      seedText: 'integer-zero',
      generatorVersion: 1,
      worldTime: -0,
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 20 },
      snapshot: snapshot(),
      gameplay: {},
    } as unknown as AuthorityReady;
    const context = {
      worldId: 'world',
      serverEpoch: 'server',
      sessionId: 'session',
      contentVersion: 'content',
      physicsSchema: { version: 1, bodyRegistryVersion: 1 },
      fluidSchema: { version: 1, encoding: 'source' },
      publicCapabilities: [] as const,
      limits: {
        metadataBytesMax: 1,
        reliableMessageBytesMax: 1,
        baselineTransferBytesMax: 1,
        baselineInFlightBytesMax: 1,
        inboundMessagesPerSecond: 1,
        inboundBurst: 1,
        actionMessagesPerSecond: 1,
        interestKeysMax: 1,
        canonicalResidencyMax: 1,
        sendQueueBytesMax: 1,
      },
      durableCommitSequence: -0,
    };
    const welcome = projectWelcomeReference(ready, context);
    expectPositiveZero(welcome.seed);
    expectPositiveZero(welcome.initialCheckpoint.commitSequence);
    expectPositiveZero(welcome.initialCheckpoint.worldRevision);
    expectPositiveZero(welcome.initialCheckpoint.durableCommitSequence);
    expect(Object.is(welcome.worldTime, -0)).toBe(true);

    const baseline = await projectChunkBaselineReference(
      {
        status: 'available',
        key: '0,0,0',
        chunkRevision: -0,
        canonical: new ArrayBuffer(32 ** 3 * 2),
        fluid: new ArrayBuffer(32 ** 3),
      } as never,
      {
        epoch: 'integer-zero',
        worldId: 'world',
        generatorVersion: 1,
        digest: { algorithm: 'sha-256', digest: async () => '0'.repeat(64) },
      },
    );
    expectPositiveZero(baseline.chunkRevision);
  });
});
