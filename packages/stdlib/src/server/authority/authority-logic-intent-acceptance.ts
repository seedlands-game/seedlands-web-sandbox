import type { GameServer } from '../game-server';
import type { WorldModuleBinding } from '../commands/module-command';
import type { GameplayEntity, EntityLifetimeReference } from '../gameplay/entity-store';
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
  referenceFor: (id: string) => EntityLifetimeReference | null;
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
    const reference = options.referenceFor(intent.entityId);
    if (!reference) continue;
    if (intent.action && 'targetId' in intent.action) {
      const observedTarget = observedById.get(intent.action.targetId);
      const currentTarget = currentById.get(intent.action.targetId);
      if (
        !observedTarget ||
        !currentTarget ||
        options.identityRevision(currentTarget) !== observedTarget.identityRevision
      )
        continue;
    }
    const action = options.applyAction(intent.entityId, intent.action);
    canonicalChanged ||= action?.changed ?? false;
    if (action && !action.accepted) continue;
    intents.push({
      entityId: intent.entityId,
      entityReference: reference,
      wish: { x: intent.wish.x, z: intent.wish.z },
      jumpRequested: intent.jumpRequested,
      verticalIntent: intent.verticalIntent,
      expiresAtPhysicsTick: options.batch.expiresAtPhysicsTick,
    });
  }
  return { intents, canonicalChanged };
}

export function isValidLogicIntent(intent: Intent): boolean {
  if (!Number.isFinite(intent.wish.x) || !Number.isFinite(intent.wish.z) || ![-1, 0, 1].includes(intent.verticalIntent))
    return false;
  const action = intent.action;
  if (!action) return true;
  if (action.type === 'move-to') return action.target.length === 3 && action.target.every(Number.isFinite);
  if (action.type === 'start-existing-action') return Boolean(action.actionId.trim());
  return Boolean(action.targetId.trim());
}

export function applyBoundLogicAction(
  server: GameServer,
  entityId: string,
  action: Intent['action'],
  binding?: WorldModuleBinding,
) {
  if (
    binding &&
    !binding.authorizer.authorize(binding.principalId, {
      resource: 'world.action',
      operation: 'execute',
      target: { kind: 'entity', entityId },
    }).allowed
  )
    return { accepted: false, changed: false };
  return action ? server.applyActorAuthorityAction(entityId, action, binding) : null;
}
