import {
  RESIDENT_TRANSFER_CHUNK_BYTES,
  type ResidentBirthPackage,
  type ResidentWorldBinding,
} from '@seedlands/cognition-protocol';
import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';
import {
  CHARACTER_OBSERVATION_MAX_EVENTS,
  type CharacterObservation,
  type ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { PortableWorkspace } from '../workspace/index.js';

export type PortableManifest = Readonly<{
  format: 'seedlands-resident-cognition';
  version: 1;
  source: ResidentWorldBinding;
  workspaces: readonly PortableWorkspace[];
}>;
const RESIDENT_HISTORY_MAX = 1024;

export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const textId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160;
const cursor = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function validWorld(value: unknown): value is ResidentWorldBinding {
  return object(value) && ['worldId', 'timelineId', 'epoch'].every((key) => textId(value[key]));
}

export function validBinding(value: unknown, world: ResidentWorldBinding): value is ControlBinding {
  return (
    object(value) &&
    ['sessionId', 'entityId', 'incarnation'].every((key) => textId(value[key])) &&
    value.worldId === world.worldId &&
    value.epoch === world.epoch &&
    cursor(value.policyRevision)
  );
}

function validCoverage(value: unknown): value is CharacterObservation['eventCoverage'] {
  if (!object(value) || !cursor(value.requestedAfter) || !cursor(value.through) || !cursor(value.returnedThrough))
    return false;
  return (
    value.requestedAfter <= value.returnedThrough &&
    value.returnedThrough <= value.through &&
    typeof value.hasMore === 'boolean' &&
    (!value.lostRange ||
      (object(value.lostRange) &&
        cursor(value.lostRange.from) &&
        cursor(value.lostRange.to) &&
        value.lostRange.from <= value.lostRange.to &&
        value.lostRange.to <= value.through))
  );
}

export function observationMatches(value: unknown, binding: ControlBinding): value is CharacterObservation {
  if (!object(value) || !object(value.character) || !object(value.self) || !validCoverage(value.eventCoverage))
    return false;
  if (
    value.character.entityId !== binding.entityId ||
    value.character.incarnation !== binding.incarnation ||
    !object(value.character.behaviorTree) ||
    !Array.isArray(value.events) ||
    value.events.length > CHARACTER_OBSERVATION_MAX_EVENTS ||
    !Array.isArray(value.visibleEntities) ||
    !Array.isArray(value.visiblePois)
  )
    return false;
  let previous = value.eventCoverage.requestedAfter;
  for (const event of value.events) {
    if (
      !object(event) ||
      !cursor(event.cursor) ||
      event.cursor <= previous ||
      event.cursor > value.eventCoverage.returnedThrough
    )
      return false;
    previous = event.cursor;
  }
  return value.events.length === 0 || previous === value.eventCoverage.returnedThrough;
}

export function validCapabilities(value: unknown): value is readonly BehaviorCapability[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(
      (entry) =>
        object(entry) &&
        textId(entry.name) &&
        (entry.kind === 'condition' || entry.kind === 'skill') &&
        typeof entry.description === 'string' &&
        entry.description.length <= 1000 &&
        object(entry.arguments),
    )
  );
}

export function validBirth(value: unknown, observation?: CharacterObservation): value is ResidentBirthPackage {
  if (
    !object(value) ||
    !textId(value.birthId) ||
    !object(value.profile) ||
    !object(value.goal) ||
    !object(value.definition) ||
    !textId(value.profile.name) ||
    typeof value.profile.personality !== 'string' ||
    typeof value.agent !== 'string' ||
    typeof value.soul !== 'string' ||
    typeof value.memory !== 'string'
  )
    return false;
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) return false;
  return (
    !observation ||
    (sameJson(value.profile, observation.character.profile) &&
      sameJson(value.goal, observation.character.behaviorTree.goal) &&
      sameJson(value.definition, observation.character.behaviorTree.definition))
  );
}

export function decodeChunk(content: unknown): Buffer | null {
  if (
    typeof content !== 'string' ||
    content.length === 0 ||
    content.length > Math.ceil(RESIDENT_TRANSFER_CHUNK_BYTES / 3) * 4
  )
    return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(content)) return null;
  const bytes = Buffer.from(content, 'base64');
  return bytes.byteLength <= RESIDENT_TRANSFER_CHUNK_BYTES && bytes.toString('base64') === content ? bytes : null;
}

export function parseManifest(bytes: Buffer, target: ResidentWorldBinding): PortableManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('checkpoint manifest is not valid UTF-8 JSON');
  }
  if (
    !object(raw) ||
    raw.format !== 'seedlands-resident-cognition' ||
    raw.version !== 1 ||
    !validWorld(raw.source) ||
    raw.source.worldId !== target.worldId ||
    raw.source.timelineId === target.timelineId ||
    !Array.isArray(raw.workspaces) ||
    raw.workspaces.length > RESIDENT_HISTORY_MAX
  )
    throw new Error('checkpoint source or target timeline is invalid');
  const identities = new Set<string>();
  for (const portable of raw.workspaces) {
    if (
      !object(portable) ||
      portable.format !== 'seedlands-npc-workspace' ||
      portable.schemaVersion !== 1 ||
      !object(portable.binding)
    )
      throw new Error('checkpoint workspace is invalid');
    const binding = portable.binding;
    if (
      binding.worldId !== raw.source.worldId ||
      binding.timelineId !== raw.source.timelineId ||
      !textId(binding.actorId) ||
      !textId(binding.incarnation)
    )
      throw new Error('checkpoint actor binding is invalid');
    const key = JSON.stringify([binding.actorId, binding.incarnation]);
    if (identities.has(key)) throw new Error('checkpoint actor binding is duplicated');
    identities.add(key);
  }
  return raw as unknown as PortableManifest;
}
