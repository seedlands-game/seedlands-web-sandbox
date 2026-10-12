import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';
import { PlayerController } from '../../../src/app/player/player-controller';
import { PLAYER_FEET_OFFSET } from '../../../src/app/player/player-view-offsets';
import type { RevisionedPredictionWorld } from '../../../src/client/local-player-prediction';

const snapshot = (): AuthoritySnapshot => {
  const player = {
    id: 'player-1',
    type: 'player' as const,
    body: { position: { x: 4, y: 5, z: 1 }, velocity: { x: 0, y: 0, z: 0 } },
    grounded: false,
    contacts: [],
  };
  return {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'world:1',
    physicsTick: 1,
    commitSequence: 1,
    worldMutationCount: 0,
    acknowledgedInputSequence: 0,
    inputResyncRequired: false,
    activeTimeMs: 1000 / 60,
    integratedPhysicsTimeMs: 1000 / 60,
    physicsDebtMs: 0,
    player,
    entities: [player],
    chunkRevisions: { '0,0,0': 1 },
    worldRevision: 1,
    worldTime: 9,
    paused: false,
  };
};

const fixture = (available = true) => {
  const camera = new pc.Entity();
  camera.setPosition(0, PLAYER_FEET_OFFSET, 0);
  const world: RevisionedPredictionWorld = {
    querySolids: () => [],
    revisionVector: () => ({ '0,0,0': 1 }),
  };
  const controller = new PlayerController({
    camera,
    canvas: {} as HTMLCanvasElement,
    physicsHz: 60,
    authority: { epoch: 'world:1', snapshot: () => null, sendInput: vi.fn(), setPlayerPosition: vi.fn() },
    getWorld: () => (available ? { updateStreaming: vi.fn() } : null),
    getEnvironment: () => null,
    canTargetFluidSource: () => false,
    isUiBlockingInput: () => false,
  } as never);
  // Empty loaded physics is the boundary fixture; prediction and the camera are real.
  Object.defineProperty(controller, 'collisionWorld', { value: () => world });
  return { controller, camera };
};

describe('Authority player presentation without a render update', () => {
  it('publishes reconciled position to the camera immediately on receipt', () => {
    const { controller, camera } = fixture();
    controller.applyAuthoritySnapshot(snapshot());
    expect(controller.predictedPhysicsState?.state.position).toEqual({ x: 4, y: 5, z: 1 });
    expect(camera.getPosition().x).toBe(4);
    expect(camera.getPosition().y).toBeCloseTo(5 + PLAYER_FEET_OFFSET);
    expect(camera.getPosition().z).toBe(1);
  });

  it('keeps a spectator camera independent from the player body', () => {
    const { controller, camera } = fixture();
    controller.setSpectatorPosition(8, 9, 10);
    controller.applyAuthoritySnapshot(snapshot());
    expect(camera.getPosition().toArray()).toEqual([8, 9, 10]);
  });

  it('does not publish a position after the world has disappeared', () => {
    const { controller, camera } = fixture(false);
    controller.applyAuthoritySnapshot(snapshot());
    expect(camera.getPosition().x).toBe(0);
    expect(camera.getPosition().y).toBeCloseTo(PLAYER_FEET_OFFSET);
    expect(camera.getPosition().z).toBe(0);
  });
});
