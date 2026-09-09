import type { GameplayEntity } from '../gameplay/entity-store';
import type { LogicIntentBatch, LogicObservation } from '../logic/logic-protocol';
import type { LogicIntent } from './authority-session';

type Intent = LogicIntentBatch['intents'][number];
type Options = Readonly<{
  batch: LogicIntentBatch;
  observation: LogicObservation;
  latestPhysicsTick: number;
  physicsHz: number;
  currentEntities: readonly GameplayEntity[];
  identityRevision: (entity: GameplayEntity) => number;
  currentChunkRevisions: (reads: Intent['readChunkRevisions']) => boolean;
  applyAction: (entityId: string, action: Intent['action']) => { accepted: boolean; changed: boolean } | null;
  validIntent: (intent: Intent) => boolean;
}>;

export function acceptLogicIntentBatch(options: Options): {
  intents: LogicIntent[];
  canonicalChanged: boolean;
} {
  const observedById = new Map(options.observation.entities.map((entity) => [entity.id, entity] as const));
  const currentById = new Map(options.currentEntities.map((entity) => [entity.id, entity] as const));
  const maximumPoseStaleness = Math.ceil(options.physicsHz * 0.2);
  const intents: LogicIntent[] = [];
  let canonicalChanged = false;
  for (const intent of options.batch.intents) {
    const observed = observedById.get(intent.entityId);
    const current = currentById.get(intent.entityId);
    if (
      !observed ||
      !current ||
      observed.identityRevision !== intent.identityRevision ||
      observed.poseRevision !== intent.observedPoseRevision ||
      options.identityRevision(current) !== intent.identityRevision ||
      options.latestPhysicsTick - intent.observedPoseRevision > maximumPoseStaleness ||
      !options.currentChunkRevisions(intent.readChunkRevisions) ||
      !options.validIntent(intent)
    )
      continue;
    const action = options.applyAction(intent.entityId, intent.action);
    canonicalChanged ||= action?.changed ?? false;
    if (action && !action.accepted) continue;
    intents.push({
      entityId: intent.entityId,
      wish: { x: intent.wish.x, z: intent.wish.z },
      jumpRequested: intent.jumpRequested,
      verticalIntent: intent.verticalIntent,
      expiresAtPhysicsTick: options.batch.expiresAtPhysicsTick,
    });
  }
  return { intents, canonicalChanged };
}
