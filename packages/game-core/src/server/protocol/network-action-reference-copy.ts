import type { AuthorityAction } from '../../compute/authority-worker-protocol';
import { canonicalReferenceInteger } from './network-reference-integer';

const actionTypes = new Set<AuthorityAction['type']>([
  'station',
  'select-hotbar',
  'craft',
  'attack',
  'begin-break',
  'cancel-break',
  'place',
  'respawn',
  'move-inventory',
  'use-inventory',
]);
const isAuthorityActionType = (value: string): value is AuthorityAction['type'] =>
  actionTypes.has(value as AuthorityAction['type']);

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid action.');
  return value as Record<string, unknown>;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError(`Invalid ${field}.`);
  return value;
};

const nonNegativeSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${field}.`);
  return canonicalReferenceInteger(value);
};

const position = (value: unknown): [number, number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Object.hasOwn(value, 0) ||
    !Object.hasOwn(value, 1) ||
    !Object.hasOwn(value, 2) ||
    !value.every(Number.isSafeInteger)
  )
    throw new TypeError('Invalid action position.');
  return [
    canonicalReferenceInteger(value[0]),
    canonicalReferenceInteger(value[1]),
    canonicalReferenceInteger(value[2]),
  ];
};

/** 仅保留 Host 真实接收的 AuthorityAction 字段，丢弃任意扩展字段。 */
export function copyAuthorityActionReference(value: unknown): AuthorityAction {
  const source = record(value);
  const type = source.type;
  if (typeof type !== 'string' || !isAuthorityActionType(type)) throw new TypeError('Unsupported public action.');
  switch (type) {
    case 'station': {
      const ref = record(source.reference);
      const reference = {
        entityId: text(ref.entityId, 'entityId'),
        epoch: nonNegativeSafeInteger(ref.epoch, 'epoch'),
        lifetime: nonNegativeSafeInteger(ref.lifetime, 'lifetime'),
      };
      if (!reference.epoch || !reference.lifetime) throw new TypeError('Invalid station reference.');
      const base = {
        type,
        reference,
        expectedStationRevision: nonNegativeSafeInteger(source.expectedStationRevision, 'stationRevision'),
      };
      if (source.kind === 'craft') return { ...base, kind: 'craft', recipeId: text(source.recipeId, 'recipeId') };
      if (source.kind !== 'transfer' || (source.from !== 'actor' && source.from !== 'station'))
        throw new TypeError('Invalid station transfer.');
      return {
        ...base,
        kind: 'transfer',
        from: source.from,
        actorSlot: nonNegativeSafeInteger(source.actorSlot, 'actorSlot'),
        stationSlot: nonNegativeSafeInteger(source.stationSlot, 'stationSlot'),
        ...(source.count === undefined ? {} : { count: nonNegativeSafeInteger(source.count, 'count') }),
      };
    }
    case 'cancel-break':
    case 'respawn':
      return { type };
    case 'select-hotbar':
    case 'use-inventory':
      return { type, slot: nonNegativeSafeInteger(source.slot, 'slot') };
    case 'craft':
      return { type: 'craft', recipeId: text(source.recipeId, 'recipeId') };
    case 'attack':
      return { type: 'attack', targetId: text(source.targetId, 'targetId') };
    case 'move-inventory':
      return {
        type: 'move-inventory',
        source: nonNegativeSafeInteger(source.source, 'source'),
        target: nonNegativeSafeInteger(source.target, 'target'),
      };
    case 'begin-break':
    case 'place':
      return { type, position: position(source.position) };
  }
}
