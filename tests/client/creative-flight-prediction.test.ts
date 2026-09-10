import { expect, it } from 'vitest';
import {
  LocalPlayerPrediction,
  type PredictionAuthorityState,
} from '../../apps/web/src/client/local-player-prediction';
const world = { querySolids: () => [], revisionVector: () => ({}) };
const snapshot = (revision: string, flightSpeed: number | null): PredictionAuthorityState => ({
  physicsTick: 0,
  acknowledgedInputSequence: -1,
  inputResyncRequired: false,
  chunkRevisions: {},
  player: {
    body: { position: { x: 0, y: 8, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
    grounded: false,
    movement: { revision, flightSpeed },
  },
});
const keys = { forward: false, back: false, left: false, right: false, jump: true, crouch: false };
it('predicts and replays the authority flight mode and drops pre-transition frames', () => {
  const prediction = new LocalPlayerPrediction('mode:1', 60);
  const creative = snapshot('creative:1:1', 4.5);
  const result = prediction.advance({
    snapshot: creative,
    elapsedSeconds: 1 / 60,
    issuedAtMs: 1,
    world,
    forward: { x: 1, z: 0 },
    right: { x: 0, z: 1 },
    keys,
  });
  expect(result.body.position.y).toBeCloseTo(8.075);
  expect(result.commands[0].movementRevision).toBe('creative:1:1');
  expect(prediction.applyAuthoritySnapshot(creative, world).body.position.y).toBeCloseTo(8.075);
  prediction.applyAuthoritySnapshot(snapshot('survival:2:2', null), world);
  expect(prediction.pendingFrames).toHaveLength(0);
  expect(prediction.physicalBody!.position.y).toBe(8);
});
