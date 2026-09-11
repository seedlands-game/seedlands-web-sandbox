import { describe, expect, it, vi } from 'vitest';
import { acceptLogicIntentBatch } from '../../../../../../packages/stdlib/src/server/authority/authority-logic-intent-acceptance';
import { EntityStore } from '../../../fixtures/classic/content';
import type {
  LogicIntentBatch,
  LogicObservation,
} from '../../../../../../packages/stdlib/src/server/logic/logic-protocol';

const fixture = (targetRevision: number) => {
  const entities = new EntityStore();
  entities.spawn({ id: 'actor', type: 'creature', position: [0, 1, 0] });
  entities.spawn({ id: 'target', type: 'player', position: [1, 1, 0] });
  const observation: LogicObservation = {
    protocolVersion: 1,
    epoch: 'session',
    observationSequence: 1,
    physicsTick: 10,
    activeTimeMs: 100,
    worldTime: 9,
    entities: entities.query().map((entity) => ({
      id: entity.id,
      bodyKind: entity.type === 'player' ? 'player' : 'grazer',
      identityRevision: 1,
      poseRevision: 10,
      position: entity.position,
      velocity: [0, 0, 0],
      grounded: true,
    })),
    decisionContext: { actors: [], pois: { version: 1, sequence: 0, pois: [] }, terrainWindows: [] },
  };
  const batch: LogicIntentBatch = {
    protocolVersion: 1,
    epoch: 'session',
    observationSequence: 1,
    expiresAtPhysicsTick: 20,
    intents: [
      {
        entityId: 'actor',
        identityRevision: 1,
        observedPoseRevision: 10,
        readChunkRevisions: [],
        wish: { x: 1, z: 0 },
        jumpRequested: false,
        verticalIntent: 0,
        action: { type: 'attack', targetId: 'target' },
      },
    ],
  };
  const applyAction = vi.fn(() => ({ accepted: true, changed: true }));
  return {
    entities,
    applyAction,
    run: () =>
      acceptLogicIntentBatch({
        batch,
        observation,
        latestPhysicsTick: 10,
        physicsHz: 60,
        currentEntities: entities.query(),
        identityRevision: (entity) => (entity.id === 'target' ? targetRevision : 1),
        referenceFor: (id) => entities.createReference(id),
        currentChunkRevisions: () => true,
        applyAction,
        validIntent: () => true,
      }),
  };
};

describe('logic observation target lifetime acceptance', () => {
  it('rejects a stale observed target before applying the action or accepting movement', () => {
    const test = fixture(2);
    expect(test.run()).toEqual({ intents: [], canonicalChanged: false });
    expect(test.applyAction).not.toHaveBeenCalled();
  });

  it('binds accepted movement to the current actor lifetime for the later physics checkpoint', () => {
    const test = fixture(1);
    const accepted = test.run();
    expect(test.applyAction).toHaveBeenCalledOnce();
    expect(accepted.intents[0]?.entityReference).toEqual(test.entities.createReference('actor'));
    expect(accepted.canonicalChanged).toBe(true);
  });
});
