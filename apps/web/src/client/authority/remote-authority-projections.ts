import type {
  AuthorityGameplayMetrics,
  AuthorityGameplayView,
  AuthorityReady,
} from '@seedlands/game-core/compute/authority-worker-protocol';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import type { SessionEpoch } from '@seedlands/game-core/runtime/session-protocol';
import { assertItemStack, type ItemStack } from '@seedlands/game-core/server/gameplay/item-registry';
import { projectCombatReference } from '@seedlands/game-core/server/protocol/network-reference-projection';
import type { PublicSessionRef } from '@seedlands/game-core/server/protocol/network-message-semantics';
import type { GameplayConsumerReference } from '@seedlands/game-core/server/protocol/network-gameplay-consumer-reference';
import type { PlayerCorrectionReference } from '@seedlands/game-core/server/protocol/network-reference-projection';
import type { WorldCommitPresentationReference } from '@seedlands/game-core/server/protocol/network-reference-world-commit-presentation';
import type { WelcomePresentationReferenceV2 } from '@seedlands/game-core/server/protocol/network-reference-bootstrap-presentation';
import type { InterestSessionRef } from '@seedlands/game-core/server/protocol/network-reference-interest-control';

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};

export const parseLocalPlayableUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Node 地址无效。');
  }
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname) ||
    !url.port ||
    url.pathname !== '/seedlands' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('本轮远端入口只允许本机 ws://host:port/seedlands，且不能包含凭据、查询或片段。');
  return url.href;
};

export const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} 无效。`);
  rejectNegativeZero(value);
  return value;
};
export const integer = (value: unknown, label: string): number => {
  const result = finite(value, label);
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError(`${label} 无效。`);
  return result;
};
const rejectNegativeZero = (value: number) => {
  if (Object.is(value, -0)) throw new TypeError('网络数值不能是负零。');
};
export const tuple = (value: unknown, label: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} 无效。`);
  return [finite(value[0], label), finite(value[1], label), finite(value[2], label)];
};
export const sameRef = (left: PublicSessionRef, right: PublicSessionRef) =>
  sessionRefIdentity(left) === sessionRefIdentity(right);
const sessionRefIdentity = (value: PublicSessionRef) =>
  `${value.protocolVersion}\u0000${value.sessionEpoch}\u0000${value.worldId}\u0000${value.playerId}`;

export const digest = {
  algorithm: 'sha-256' as const,
  digest: async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(''),
};
export const sizer = {
  measureMetadataBytes: (value: unknown) => utf8.encode(JSON.stringify(value)).byteLength,
  measureReliableMessageBytes: (value: unknown, payload: Uint8Array) =>
    utf8.encode(JSON.stringify(value)).byteLength + payload.byteLength,
};

const zeroMetrics = (): AuthorityGameplayMetrics => ({
  entityCount: 0,
  worldItemCount: 0,
  creatureCount: 0,
  npcCount: 0,
  nearbyVisitedBucketCount: 0,
  nearbyCandidateCount: 0,
  nearbyReturnedCount: 0,
  inventoryOperationCount: 0,
  gameplayEventCount: 0,
  snapshotBytes: 0,
  retainedActorCount: 0,
  activeActorCount: 0,
  behaviorEvaluationCount: 0,
  navigationPlanCount: 0,
  navigationExpandedNodeCount: 0,
  pathRecomputeCount: 0,
  actionCompletionCount: 0,
  actionFailureCount: 0,
  actionInterruptionCount: 0,
  perceptionLineOfSightCheckCount: 0,
  simulationTime: 0,
});

export const gameplayFromReference = (value: GameplayConsumerReference): AuthorityGameplayView => {
  const actorBehaviors = new Map(value.actorBehaviors.map((actor) => [actor.entityId, actor.behavior]));
  const entities = value.entities.map((entity): AuthorityGameplayView['entities'][number] => {
    const { stack: sourceStack, combat: sourceCombat, ...source } = entity;
    const combat = projectCombatReference(sourceCombat);
    const stack = sourceStack ? { ...sourceStack } : undefined;
    if (stack) assertItemStack(stack);
    const projected: AuthorityGameplayView['entities'][number] = {
      ...(combat ? { combat } : {}),
      ...source,
      kind: entity.type,
      lifecycle: 'active' as const,
      position: tuple(entity.position, 'entity.position'),
      physicsVelocity: [0, 0, 0] as [number, number, number],
    };
    if (stack) projected.stack = stack;
    return projected;
  });
  const actors = entities.flatMap((entity) => {
    const behavior = actorBehaviors.get(entity.id);
    if (!behavior || !entity.archetype) return [];
    return [
      {
        entityId: entity.id,
        archetype: entity.archetype,
        hunger: 0,
        behavior,
        targetEntityId: null,
        homePoiId: null,
        workPoiId: null,
        foodPoiId: null,
        active: true,
        attackCooldownSeconds: entity.combat?.cooldownRemainingSeconds ?? 0,
        wanderIndex: 0,
      },
    ];
  });
  const inventory = value.player.inventory.map((slot): ItemStack | null => {
    if (!slot) return null;
    const stack = { itemId: slot.itemId, count: slot.count };
    assertItemStack(stack);
    return stack;
  });
  const combat = projectCombatReference(value.player.combat);
  return {
    gameplayRevision: integer(value.gameplayRevision, 'gameplayRevision'),
    gameplayTime: finite(value.gameplayTime, 'gameplayTime'),
    player: {
      ...(combat ? { combat } : {}),
      entityId: value.player.entityId,
      spawnPosition: [0, 0, 0],
      health: finite(value.player.health, 'player.health'),
      maxHealth: 20,
      hunger: finite(value.player.hunger, 'player.hunger'),
      maxHunger: 20,
      lifecycle: value.player.lifecycle,
      inventory,
      selectedSlot: integer(value.player.selectedSlot, 'player.selectedSlot'),
      hotbarSize: 8,
      attackCooldownSeconds: combat?.cooldownRemainingSeconds ?? 0,
      hungerAccumulator: 0,
      healingAccumulator: 0,
      starvationAccumulator: 0,
      breakAction: value.player.breakAction
        ? { ...value.player.breakAction, position: [...value.player.breakAction.position] }
        : null,
    },
    entities,
    actors,
    craftableRecipeIds: [...value.craftableRecipeIds],
    metrics: { ...zeroMetrics(), entityCount: entities.length, retainedActorCount: actors.length },
  };
};

export const snapshotFromCorrection = (epoch: SessionEpoch, value: PlayerCorrectionReference): AuthoritySnapshot => {
  const player = {
    id: value.player.id,
    type: 'player' as const,
    body: {
      position: { ...value.player.position },
      velocity: { ...value.player.velocity },
    },
    grounded: value.player.grounded,
    contacts: [],
  };
  return {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch,
    physicsTick: integer(value.physicsTick, 'physicsTick'),
    commitSequence: integer(value.commitSequence, 'commitSequence'),
    worldMutationCount: 0,
    acknowledgedInputSequence: value.acknowledgedInputSequence,
    inputResyncRequired: value.inputResyncRequired,
    activeTimeMs: 0,
    integratedPhysicsTimeMs: 0,
    physicsDebtMs: 0,
    player,
    entities: [player],
    chunkRevisions: Object.fromEntries(value.collisionRevisions.map(({ key, revision }) => [key, revision])),
    worldRevision: integer(value.worldRevision, 'worldRevision'),
    worldTime: finite(value.worldTime, 'worldTime'),
    paused: false,
  };
};

export const commitFromReference = (value: WorldCommitPresentationReference): WorldCommitResult => ({
  committed: value.committed,
  worldRevision: value.worldRevision,
  structuralChange: value.structuralChange
    ? {
        type: 'voxel-region-changed',
        worldRevision: value.worldRevision,
        actorId: value.structuralChange.presentationClass === 'fluid' ? 'fluid-v2' : 'remote-player',
        mutationCount: value.structuralChange.mutationCount,
        chunks: [...value.structuralChange.chunks],
        meshChunks: [...value.structuralChange.meshChunks],
        chunkRevisions: value.structuralChange.chunkRevisions.map((entry) => ({ ...entry })),
        bounds: value.structuralChange.bounds
          ? { min: [...value.structuralChange.bounds.min], max: [...value.structuralChange.bounds.max] }
          : null,
      }
    : null,
  collisionDelta: value.collisionDeltas.map((delta) => ({
    ...delta,
    cells: delta.cells.map((cell) => ({ ...cell })),
  })),
  semanticEvents: [],
  metrics: {
    timingStatus: 'not-collected-hot-path',
    inputMutationCount: value.structuralChange?.mutationCount ?? 0,
    canonicalWriteCount: value.collisionDeltas.reduce((sum, delta) => sum + delta.cells.length, 0),
    dirtyChunkCount: value.structuralChange?.chunks.length ?? 0,
    meshInvalidationCount: value.structuralChange?.meshChunks.length ?? 0,
    structuralEventCount: value.structuralChange ? 1 : 0,
    semanticEventCount: 0,
    mutationPayloadBytes: 0,
    mutationCapacityBytes: 0,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});

type RemoteWelcome = Readonly<{
  kind: 'welcome';
  ref: PublicSessionRef;
  serverEpoch: string;
  physicsHz: 30 | 60 | 120;
  presentation: WelcomePresentationReferenceV2;
  gameplay: GameplayConsumerReference;
}>;

export const projectRemoteWelcome = (epoch: SessionEpoch, message: Record<string, unknown>) => {
  if (message.kind !== 'welcome') throw new Error('Node 未返回 welcome。');
  const welcome = message as unknown as RemoteWelcome;
  if (!welcome.presentation || !welcome.gameplay || welcome.presentation.kind !== 'welcome-presentation-reference')
    throw new Error('Node welcome 缺少完整世界投影。');
  const presentation = welcome.presentation;
  const interestRef: InterestSessionRef = {
    epoch: presentation.epoch,
    serverEpoch: welcome.serverEpoch,
    sessionId: welcome.ref.sessionEpoch,
    worldId: welcome.ref.worldId,
  };
  const gameplay = gameplayFromReference(welcome.gameplay);
  const correction: PlayerCorrectionReference = {
    kind: 'player-correction-reference',
    projectionVersion: 1,
    epoch: presentation.epoch,
    physicsTick: presentation.initialCheckpoint.physicsTick,
    commitSequence: presentation.initialCheckpoint.commitSequence,
    worldRevision: presentation.initialCheckpoint.worldRevision,
    worldTime: presentation.worldTime,
    acknowledgedInputSequence: -1,
    inputResyncRequired: false,
    paused: false,
    player: { id: presentation.playerId, ...presentation.playerBody },
    collisionRevisions: [],
  };
  const snapshot = snapshotFromCorrection(epoch, correction);
  const camp = presentation.authorityStartPresentation.campPosition;
  const ready: AuthorityReady = {
    playerId: presentation.playerId,
    playerBodyPosition: tuple(
      [presentation.playerBody.position.x, presentation.playerBody.position.y, presentation.playerBody.position.z],
      'playerBodyPosition',
    ),
    isNew: presentation.authorityStartPresentation.authorityStartPlayerWasCreated,
    seed: presentation.seed,
    seedText: presentation.seedText,
    generatorVersion: presentation.generatorVersion,
    worldTime: presentation.worldTime,
    frequencies: presentation.frequencies,
    snapshot,
    gameplay,
    ...(camp ? { campPosition: [...camp] } : {}),
  };
  return { welcome, interestRef, gameplay, snapshot, ready };
};
