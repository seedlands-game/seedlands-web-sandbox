import type { CharacterObservation, ControlBinding } from '@seedlands/game-core/runtime/character-control-protocol';
import type { ControllerClientMessage } from '@seedlands/cognition-protocol';
import {
  CHARACTER_OBSERVATION_MAX_EVENTS,
  CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES,
  CHARACTER_OBSERVATION_MAX_VISIBLE_POIS,
} from '@seedlands/game-core/runtime/character-control-protocol';

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const exactKeys = (source: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = Object.keys(source);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
};

const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const CHARACTER_RETAINED_EVENT_LIMIT = 128;

function validEventPage(events: readonly unknown[], pageCursor: number, headCursor: number): boolean {
  if (
    !Number.isSafeInteger(pageCursor) ||
    pageCursor < 0 ||
    !Number.isSafeInteger(headCursor) ||
    headCursor < 0 ||
    pageCursor > headCursor
  )
    return false;
  if (events.length === 0) return pageCursor === headCursor;
  if (events.length < CHARACTER_OBSERVATION_MAX_EVENTS && pageCursor !== headCursor) return false;

  let previousCursor = pageCursor - events.length;
  if (previousCursor < 0) return false;
  for (const event of events) {
    const entry = record(event);
    if (
      !entry ||
      !Number.isSafeInteger(entry.cursor) ||
      entry.cursor !== previousCursor + 1 ||
      (entry.cursor as number) > pageCursor ||
      (entry.cursor as number) <= headCursor - CHARACTER_RETAINED_EVENT_LIMIT ||
      (entry.text !== undefined && (typeof entry.text !== 'string' || entry.text.length > 2000)) ||
      (entry.reason !== undefined && (typeof entry.reason !== 'string' || entry.reason.length > 2000))
    )
      return false;
    previousCursor = entry.cursor as number;
  }
  return previousCursor === pageCursor;
}

function parseBinding(value: unknown): ControlBinding | null {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ['sessionId', 'worldId', 'epoch', 'entityId', 'incarnation', 'policyRevision']) ||
    !boundedText(source.sessionId, 128) ||
    !boundedText(source.worldId, 256) ||
    !boundedText(source.epoch, 128) ||
    !boundedText(source.entityId, 128) ||
    !boundedText(source.incarnation, 128) ||
    !Number.isSafeInteger(source.policyRevision) ||
    (source.policyRevision as number) < 0
  )
    return null;
  return source as ControlBinding;
}

function validObservation(value: unknown, binding: ControlBinding): value is CharacterObservation {
  const source = record(value);
  const character = record(source?.character);
  if (
    !source ||
    !character ||
    !Array.isArray(source.visibleEntities) ||
    source.visibleEntities.length > CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES ||
    !Array.isArray(source.visiblePois) ||
    source.visiblePois.length > CHARACTER_OBSERVATION_MAX_VISIBLE_POIS ||
    !Array.isArray(source.events) ||
    source.events.length > CHARACTER_OBSERVATION_MAX_EVENTS ||
    !Number.isSafeInteger(source.cursor) ||
    (source.cursor as number) < 0 ||
    !Number.isSafeInteger(character.eventCursor) ||
    (character.eventCursor as number) < 0 ||
    character.entityId !== binding.entityId ||
    character.incarnation !== binding.incarnation ||
    (character.lifecycle !== 'active' && character.lifecycle !== 'deceased') ||
    !Number.isSafeInteger(character.policyRevision) ||
    (character.policyRevision as number) < 0 ||
    (character.lifecycle === 'active' && character.policyRevision !== binding.policyRevision) ||
    !record(character.memory) ||
    typeof record(character.memory)?.summary !== 'string' ||
    (record(character.memory)?.summary as string).length > 16_000 ||
    !Number.isSafeInteger(character.revision) ||
    (character.revision as number) < 0
  )
    return false;
  return validEventPage(source.events, source.cursor as number, character.eventCursor as number);
}

export function parseControllerClientMessage(value: unknown): ControllerClientMessage | null {
  const source = record(value);
  if (
    !source ||
    source.protocolVersion !== 1 ||
    !Number.isSafeInteger(source.sequence) ||
    (source.sequence as number) < 0
  )
    return null;
  const binding = parseBinding(source.binding);
  if (!binding || typeof source.kind !== 'string') return null;

  if (source.kind === 'hello') {
    if (!exactKeys(source, ['kind', 'protocolVersion', 'binding', 'sequence', 'pairingToken'])) return null;
    return boundedText(source.pairingToken, 512) ? (source as unknown as ControllerClientMessage) : null;
  }
  if (source.kind === 'observe') {
    if (!exactKeys(source, ['kind', 'protocolVersion', 'binding', 'sequence', 'observation'])) return null;
    return validObservation(source.observation, binding) ? (source as unknown as ControllerClientMessage) : null;
  }
  if (source.kind === 'receipt') {
    if (!exactKeys(source, ['kind', 'protocolVersion', 'binding', 'sequence', 'receipt'])) return null;
    const receipt = record(source.receipt);
    if (
      !receipt ||
      !exactKeys(
        receipt,
        receipt.actionId === undefined && receipt.reason === undefined
          ? ['requestId', 'status', 'cursor', 'revision']
          : receipt.actionId === undefined
            ? ['requestId', 'status', 'reason', 'cursor', 'revision']
            : receipt.reason === undefined
              ? ['requestId', 'actionId', 'status', 'cursor', 'revision']
              : ['requestId', 'actionId', 'status', 'reason', 'cursor', 'revision'],
      ) ||
      !boundedText(receipt.requestId, 128) ||
      !['accepted', 'rejected', 'succeeded', 'failed', 'interrupted'].includes(String(receipt.status)) ||
      !Number.isSafeInteger(receipt.cursor) ||
      (receipt.cursor as number) < 0 ||
      !Number.isSafeInteger(receipt.revision) ||
      (receipt.revision as number) < 0 ||
      (receipt.actionId !== undefined && !boundedText(receipt.actionId, 128)) ||
      (receipt.reason !== undefined && (typeof receipt.reason !== 'string' || receipt.reason.length > 512))
    )
      return null;
    return source as unknown as ControllerClientMessage;
  }
  if (source.kind === 'control') {
    if (!exactKeys(source, ['kind', 'protocolVersion', 'binding', 'sequence', 'command'])) return null;
    return source.command === 'pause' || source.command === 'resume' || source.command === 'unbind'
      ? (source as unknown as ControllerClientMessage)
      : null;
  }
  if (source.kind === 'configure') {
    if (!exactKeys(source, ['kind', 'protocolVersion', 'binding', 'sequence', 'fallbackSeconds', 'contextLimit']))
      return null;
    return typeof source.fallbackSeconds === 'number' &&
      Number.isFinite(source.fallbackSeconds) &&
      source.fallbackSeconds >= 60 &&
      source.fallbackSeconds <= 600 &&
      (source.contextLimit === 128_000 || source.contextLimit === 256_000)
      ? (source as unknown as ControllerClientMessage)
      : null;
  }
  return null;
}

export function sameBinding(left: ControlBinding, right: ControlBinding): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.worldId === right.worldId &&
    left.epoch === right.epoch &&
    left.entityId === right.entityId &&
    left.incarnation === right.incarnation &&
    left.policyRevision === right.policyRevision
  );
}
