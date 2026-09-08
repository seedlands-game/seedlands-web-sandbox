import type { AuthorityAction } from '../../compute/authority-worker-protocol';

export const NETWORK_DRAFT_PROTOCOL_VERSION = 1 as const;

export type NetworkMessageClass =
  | 'welcome'
  | 'session-rejected'
  | 'input-state'
  | 'input-edge'
  | 'player-action'
  | 'interest-update'
  | 'checkpoint-request'
  | 'resync-request'
  | 'heartbeat'
  | 'disconnect'
  | 'player-correction'
  | 'entity-pose'
  | 'gameplay-view'
  | 'gameplay-event'
  | 'chunk-baseline'
  | 'chunk-delta'
  | 'world-commit-index'
  | 'checkpoint-receipt'
  | 'resync-required'
  | 'close';

export type NetworkMessageClassSpec = Readonly<{
  direction: 'inbound' | 'outbound';
  reliability: 'reliable' | 'latest';
  stream: 'control' | 'input' | 'events' | 'world' | 'pose';
}>;

export const NETWORK_MESSAGE_CLASSES: Readonly<Record<NetworkMessageClass, NetworkMessageClassSpec>> = {
  welcome: { direction: 'outbound', reliability: 'reliable', stream: 'control' },
  'session-rejected': { direction: 'outbound', reliability: 'reliable', stream: 'control' },
  'input-state': { direction: 'inbound', reliability: 'latest', stream: 'input' },
  'input-edge': { direction: 'inbound', reliability: 'reliable', stream: 'control' },
  'player-action': { direction: 'inbound', reliability: 'reliable', stream: 'events' },
  'interest-update': { direction: 'inbound', reliability: 'latest', stream: 'world' },
  'checkpoint-request': { direction: 'inbound', reliability: 'reliable', stream: 'control' },
  'resync-request': { direction: 'inbound', reliability: 'reliable', stream: 'control' },
  heartbeat: { direction: 'inbound', reliability: 'reliable', stream: 'control' },
  disconnect: { direction: 'inbound', reliability: 'reliable', stream: 'control' },
  'player-correction': { direction: 'outbound', reliability: 'reliable', stream: 'control' },
  'entity-pose': { direction: 'outbound', reliability: 'latest', stream: 'pose' },
  'gameplay-view': { direction: 'outbound', reliability: 'reliable', stream: 'events' },
  'gameplay-event': { direction: 'outbound', reliability: 'reliable', stream: 'events' },
  'chunk-baseline': { direction: 'outbound', reliability: 'reliable', stream: 'world' },
  'chunk-delta': { direction: 'outbound', reliability: 'reliable', stream: 'world' },
  'world-commit-index': { direction: 'outbound', reliability: 'reliable', stream: 'world' },
  'checkpoint-receipt': { direction: 'outbound', reliability: 'reliable', stream: 'control' },
  'resync-required': { direction: 'outbound', reliability: 'reliable', stream: 'control' },
  close: { direction: 'outbound', reliability: 'reliable', stream: 'control' },
};

export type PublicSessionRef = Readonly<{
  protocolVersion: typeof NETWORK_DRAFT_PROTOCOL_VERSION;
  sessionEpoch: string;
  worldId: string;
  playerId: string;
}>;

export type PublicInboundMessage =
  | Readonly<{
      kind: 'input-state';
      ref: PublicSessionRef;
      inputSequence: number;
      targetPhysicsTick: number;
      expiresAfterPhysicsTick: number;
      moveX: number;
      moveZ: number;
      verticalIntent: -1 | 0 | 1;
      jumpHeld: boolean;
    }>
  | Readonly<{
      kind: 'input-edge';
      ref: PublicSessionRef;
      edgeId: number;
      targetPhysicsTick: number;
      expiresAfterPhysicsTick: number;
      type: 'jump-pressed';
    }>
  | Readonly<{
      kind: 'player-action';
      ref: PublicSessionRef;
      requestId: number;
      expectedCommitSequence?: number;
      action: AuthorityAction;
    }>
  | Readonly<{ kind: 'interest-update'; ref: PublicSessionRef; requestId: number; keys: readonly string[] }>
  | Readonly<{ kind: 'checkpoint-request'; ref: PublicSessionRef; requestId: number }>
  | Readonly<{
      kind: 'resync-request';
      ref: PublicSessionRef;
      requestId: number;
      reason: 'missing-baseline' | 'sequence-gap';
    }>
  | Readonly<{ kind: 'heartbeat'; ref: PublicSessionRef; nonce: number }>
  | Readonly<{ kind: 'disconnect'; ref: PublicSessionRef; reason: 'client-close' | 'mode-switch' }>;

export type PublicOutboundMessage =
  | Readonly<{ kind: 'welcome'; ref: PublicSessionRef; serverEpoch: string; physicsHz: 30 | 60 | 120 }>
  | Readonly<{ kind: 'session-rejected'; code: 'authentication' | 'version' | 'capacity' }>
  | Readonly<{
      kind: 'player-correction';
      ref: PublicSessionRef;
      poseSequence: number;
      physicsTick: number;
      acknowledgedInputSequence: number;
      acknowledgedEdgeId: number;
      inputResyncRequired: boolean;
      body: Readonly<{ position: [number, number, number]; velocity: [number, number, number] }>;
      grounded: boolean;
      collisionRevisionVector: readonly Readonly<{ key: string; revision: number }>[];
    }>
  | Readonly<{
      kind: 'entity-pose';
      ref: PublicSessionRef;
      poseSequence: number;
      physicsTick: number;
      entities: readonly Readonly<{
        id: string;
        type: 'player' | 'world-item' | 'creature' | 'npc';
        archetype?: 'grazer' | 'night-stalker' | 'settler';
        position: [number, number, number];
        velocity: [number, number, number];
      }>[];
    }>
  | Readonly<{ kind: 'gameplay-view'; ref: PublicSessionRef; gameplayRevision: number; inventory: readonly unknown[] }>
  | Readonly<{
      kind: 'gameplay-event';
      ref: PublicSessionRef;
      gameplayRevision: number;
      requestId: number;
      success: boolean;
    }>
  | Readonly<{
      kind: 'chunk-baseline';
      ref: PublicSessionRef;
      key: string;
      revision: number;
      generatorVersion: number;
      canonicalBlock: string;
      fluidBlock?: string;
    }>
  | Readonly<{
      kind: 'chunk-delta';
      ref: PublicSessionRef;
      worldCommitSequence: number;
      key: string;
      previousRevision: number;
      revision: number;
      cells: readonly Readonly<{ index: number; voxel: number; fluid: number }>[];
    }>
  | Readonly<{ kind: 'world-commit-index'; ref: PublicSessionRef; worldCommitSequence: number }>
  | Readonly<{ kind: 'checkpoint-receipt'; ref: PublicSessionRef; requestId: number; durableCommitSequence: number }>
  | Readonly<{ kind: 'resync-required'; ref: PublicSessionRef; reason: 'missing-baseline' | 'sequence-gap' }>
  | Readonly<{ kind: 'close'; code: 'idle' | 'backpressure' | 'protocol' }>;

export type NormalizedNetworkCorpusMessage = Readonly<{
  draftVersion: typeof NETWORK_DRAFT_PROTOCOL_VERSION;
  messageClass: NetworkMessageClass;
  message: PublicInboundMessage | PublicOutboundMessage;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPosition = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const hasNoCapabilities = (value: Record<string, unknown>) => !Object.hasOwn(value, 'capabilities');
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

export const isPublicSessionRef = (value: unknown): value is PublicSessionRef =>
  isRecord(value) &&
  hasOnlyKeys(value, ['protocolVersion', 'sessionEpoch', 'worldId', 'playerId']) &&
  value.protocolVersion === NETWORK_DRAFT_PROTOCOL_VERSION &&
  isNonEmptyString(value.sessionEpoch) &&
  isNonEmptyString(value.worldId) &&
  isNonEmptyString(value.playerId);

const isAuthorityAction = (value: unknown): value is AuthorityAction => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  const actionKeys = {
    'cancel-break': [],
    respawn: [],
    'select-hotbar': ['slot'],
    'use-inventory': ['slot'],
    craft: ['recipeId'],
    attack: ['targetId'],
    'begin-break': ['position'],
    place: ['position'],
    'move-inventory': ['source', 'target'],
  } as const;
  if (
    !Object.hasOwn(actionKeys, value.type) ||
    !hasOnlyKeys(value, ['type', ...actionKeys[value.type as keyof typeof actionKeys]])
  )
    return false;
  if (value.type === 'cancel-break' || value.type === 'respawn') return true;
  if (value.type === 'select-hotbar' || value.type === 'use-inventory') return isSafeInteger(value.slot);
  if (value.type === 'craft') return isNonEmptyString(value.recipeId);
  if (value.type === 'attack') return isNonEmptyString(value.targetId);
  if (value.type === 'begin-break' || value.type === 'place') return isPosition(value.position);
  return value.type === 'move-inventory' && isSafeInteger(value.source) && isSafeInteger(value.target);
};

const inboundKeys = {
  'input-state': [
    'inputSequence',
    'targetPhysicsTick',
    'expiresAfterPhysicsTick',
    'moveX',
    'moveZ',
    'verticalIntent',
    'jumpHeld',
  ],
  'input-edge': ['edgeId', 'targetPhysicsTick', 'expiresAfterPhysicsTick', 'type'],
  'player-action': ['requestId', 'expectedCommitSequence', 'action'],
  'interest-update': ['requestId', 'keys'],
  'checkpoint-request': ['requestId'],
  'resync-request': ['requestId', 'reason'],
  heartbeat: ['nonce'],
  disconnect: ['reason'],
} as const;

export function isPublicInboundMessage(value: unknown): value is PublicInboundMessage {
  if (!isRecord(value) || !hasNoCapabilities(value) || !isPublicSessionRef(value.ref) || typeof value.kind !== 'string')
    return false;
  if (
    !Object.hasOwn(inboundKeys, value.kind) ||
    !hasOnlyKeys(value, ['kind', 'ref', ...inboundKeys[value.kind as keyof typeof inboundKeys]])
  )
    return false;
  if (value.kind === 'input-state')
    return (
      isSafeInteger(value.inputSequence) &&
      isSafeInteger(value.targetPhysicsTick) &&
      isSafeInteger(value.expiresAfterPhysicsTick) &&
      isFiniteNumber(value.moveX) &&
      Math.abs(value.moveX) <= 1 &&
      isFiniteNumber(value.moveZ) &&
      Math.abs(value.moveZ) <= 1 &&
      [-1, 0, 1].includes(value.verticalIntent as number) &&
      typeof value.jumpHeld === 'boolean'
    );
  if (value.kind === 'input-edge')
    return (
      value.type === 'jump-pressed' &&
      isSafeInteger(value.edgeId) &&
      isSafeInteger(value.targetPhysicsTick) &&
      isSafeInteger(value.expiresAfterPhysicsTick)
    );
  if (value.kind === 'player-action')
    return (
      isSafeInteger(value.requestId) &&
      (value.expectedCommitSequence === undefined || isSafeInteger(value.expectedCommitSequence)) &&
      isAuthorityAction(value.action)
    );
  if (value.kind === 'interest-update')
    return (
      isSafeInteger(value.requestId) &&
      Array.isArray(value.keys) &&
      value.keys.length <= 256 &&
      value.keys.every(isNonEmptyString)
    );
  if (value.kind === 'checkpoint-request') return isSafeInteger(value.requestId);
  if (value.kind === 'resync-request')
    return isSafeInteger(value.requestId) && (value.reason === 'missing-baseline' || value.reason === 'sequence-gap');
  if (value.kind === 'heartbeat') return isSafeInteger(value.nonce);
  return value.kind === 'disconnect' && (value.reason === 'client-close' || value.reason === 'mode-switch');
}

export function isPublicOutboundMessage(value: unknown): value is PublicOutboundMessage {
  if (!isRecord(value) || !hasNoCapabilities(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'session-rejected')
    return (
      hasOnlyKeys(value, ['kind', 'code']) &&
      typeof value.code === 'string' &&
      ['authentication', 'version', 'capacity'].includes(value.code)
    );
  if (value.kind === 'close')
    return (
      hasOnlyKeys(value, ['kind', 'code']) &&
      typeof value.code === 'string' &&
      ['idle', 'backpressure', 'protocol'].includes(value.code)
    );
  if (!isPublicSessionRef(value.ref)) return false;
  if (value.kind === 'welcome')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'serverEpoch', 'physicsHz']) &&
      isNonEmptyString(value.serverEpoch) &&
      [30, 60, 120].includes(value.physicsHz as number)
    );
  if (value.kind === 'player-correction') {
    const isAcknowledgement = (sequence: unknown) => sequence === -1 || isSafeInteger(sequence);
    return (
      hasOnlyKeys(value, [
        'kind',
        'ref',
        'poseSequence',
        'physicsTick',
        'acknowledgedInputSequence',
        'acknowledgedEdgeId',
        'inputResyncRequired',
        'body',
        'grounded',
        'collisionRevisionVector',
      ]) &&
      isSafeInteger(value.poseSequence) &&
      isSafeInteger(value.physicsTick) &&
      isAcknowledgement(value.acknowledgedInputSequence) &&
      isAcknowledgement(value.acknowledgedEdgeId) &&
      typeof value.inputResyncRequired === 'boolean' &&
      typeof value.grounded === 'boolean' &&
      isRecord(value.body) &&
      hasOnlyKeys(value.body, ['position', 'velocity']) &&
      isPosition(value.body.position) &&
      isPosition(value.body.velocity) &&
      Array.isArray(value.collisionRevisionVector) &&
      value.collisionRevisionVector.length <= 256 &&
      value.collisionRevisionVector.every(
        (entry) =>
          isRecord(entry) &&
          hasOnlyKeys(entry, ['key', 'revision']) &&
          isNonEmptyString(entry.key) &&
          isSafeInteger(entry.revision),
      )
    );
  }
  if (value.kind === 'entity-pose')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'poseSequence', 'physicsTick', 'entities']) &&
      isSafeInteger(value.poseSequence) &&
      isSafeInteger(value.physicsTick) &&
      Array.isArray(value.entities) &&
      value.entities.length <= 256 &&
      value.entities.every(
        (entity) =>
          isRecord(entity) &&
          hasOnlyKeys(entity, ['id', 'type', 'archetype', 'position', 'velocity']) &&
          (entity.archetype === undefined ||
            ['grazer', 'night-stalker', 'settler'].includes(entity.archetype as string)) &&
          isNonEmptyString(entity.id) &&
          ['player', 'world-item', 'creature', 'npc'].includes(entity.type as string) &&
          isPosition(entity.position) &&
          isPosition(entity.velocity),
      )
    );
  if (value.kind === 'chunk-baseline')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'key', 'revision', 'generatorVersion', 'canonicalBlock', 'fluidBlock']) &&
      isNonEmptyString(value.key) &&
      isSafeInteger(value.revision) &&
      isSafeInteger(value.generatorVersion) &&
      isNonEmptyString(value.canonicalBlock) &&
      (value.fluidBlock === undefined || isNonEmptyString(value.fluidBlock))
    );
  if (value.kind === 'chunk-delta')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'worldCommitSequence', 'key', 'previousRevision', 'revision', 'cells']) &&
      isSafeInteger(value.worldCommitSequence) &&
      isNonEmptyString(value.key) &&
      isSafeInteger(value.previousRevision) &&
      isSafeInteger(value.revision) &&
      value.revision > value.previousRevision &&
      Array.isArray(value.cells) &&
      value.cells.length <= 32 ** 3 &&
      value.cells.every(
        (cell) =>
          isRecord(cell) &&
          hasOnlyKeys(cell, ['index', 'voxel', 'fluid']) &&
          isSafeInteger(cell.index) &&
          cell.index < 32 ** 3 &&
          isSafeInteger(cell.voxel) &&
          cell.voxel <= 0xffff &&
          isSafeInteger(cell.fluid) &&
          cell.fluid <= 0xff,
      )
    );
  if (value.kind === 'gameplay-view')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'gameplayRevision', 'inventory']) &&
      isSafeInteger(value.gameplayRevision) &&
      Array.isArray(value.inventory) &&
      value.inventory.length <= 36
    );
  if (value.kind === 'gameplay-event')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'gameplayRevision', 'requestId', 'success']) &&
      isSafeInteger(value.gameplayRevision) &&
      isSafeInteger(value.requestId) &&
      typeof value.success === 'boolean'
    );
  if (value.kind === 'world-commit-index')
    return hasOnlyKeys(value, ['kind', 'ref', 'worldCommitSequence']) && isSafeInteger(value.worldCommitSequence);
  if (value.kind === 'checkpoint-receipt')
    return (
      hasOnlyKeys(value, ['kind', 'ref', 'requestId', 'durableCommitSequence']) &&
      isSafeInteger(value.requestId) &&
      isSafeInteger(value.durableCommitSequence)
    );
  return (
    value.kind === 'resync-required' &&
    hasOnlyKeys(value, ['kind', 'ref', 'reason']) &&
    (value.reason === 'missing-baseline' || value.reason === 'sequence-gap')
  );
}

export function normalizeNetworkCorpusMessage(
  message: PublicInboundMessage | PublicOutboundMessage,
): NormalizedNetworkCorpusMessage {
  const spec = NETWORK_MESSAGE_CLASSES[message.kind as NetworkMessageClass];
  if (!spec || (spec.direction === 'inbound' ? !isPublicInboundMessage(message) : !isPublicOutboundMessage(message)))
    throw new TypeError('Network message is outside the draft public protocol.');
  return { draftVersion: NETWORK_DRAFT_PROTOCOL_VERSION, messageClass: message.kind as NetworkMessageClass, message };
}
