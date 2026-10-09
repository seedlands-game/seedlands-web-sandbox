import type { ModStateAddress } from '../../composition/operation-contracts';
import type { MapPixel, NavigationMap } from '../navigation-items-runtime';
import { validateNavigationItemsCheckpoint } from '../navigation-items-runtime';
import type { NavigationItemsPolicyV1 } from './navigation-policy';

export const NAVIGATION_COMPONENT = 'seedlands:navigation-map';
export const NAVIGATION_RESOURCE = 'seedlands.navigation-item';
export type NavigationInteractionConfig = Readonly<{
  moduleId: string;
  operationId: string;
  policy: NavigationItemsPolicyV1;
}>;
export type NavigationObservationV1 = Readonly<{
  version: 1;
  kind: 'observation';
  actorId: string;
  alive: boolean;
  selectedItemId: string | null;
  sequence: number;
  center: readonly [number, number];
  scale: number;
  map: NavigationMap | null;
  pixels: readonly MapPixel[];
}>;
export type NavigationCandidateV1 = Readonly<{
  version: 1;
  kind: 'candidate';
  actorId: string;
  sequence: number;
  map: NavigationMap;
}>;
export const navigationAddress = (actorId: string): ModStateAddress => ({
  componentId: NAVIGATION_COMPONENT,
  target: { kind: 'entity', entityId: actorId },
});

export function validateNavigationProjection(raw: unknown): NavigationObservationV1 | NavigationCandidateV1 {
  if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('kind' in raw))
    throw new TypeError('Navigation projection is invalid.');
  const value = raw as NavigationObservationV1 | NavigationCandidateV1;
  if (!value.actorId?.trim() || (value.kind !== 'observation' && value.kind !== 'candidate'))
    throw new TypeError('Navigation actor is invalid.');
  const maps = value.map ? [value.map] : [];
  validateNavigationItemsCheckpoint({ version: 1, sequence: value.sequence, maps });
  if (value.map && value.map.playerId !== value.actorId) throw new TypeError('Navigation map owner is invalid.');
  if (value.kind === 'candidate') {
    if (!value.map) throw new TypeError('Navigation candidate requires a map.');
  } else {
    if (typeof value.alive !== 'boolean' || (value.selectedItemId !== null && typeof value.selectedItemId !== 'string'))
      throw new TypeError('Navigation selection is invalid.');
    validateNavigationItemsCheckpoint({
      version: 1,
      sequence: 1,
      maps: [{ id: 'map-1', playerId: value.actorId, center: value.center, scale: value.scale, pixels: value.pixels }],
    });
  }
  return value;
}

export function buildNavigationCandidate(
  raw: unknown,
  policy: NavigationItemsPolicyV1,
  input: unknown,
): NavigationCandidateV1 {
  const value = validateNavigationProjection(raw);
  if (value.kind !== 'observation' || !value.alive || value.selectedItemId !== policy.mapItemId)
    throw new Error('navigation-selection-stale');
  if (
    !input ||
    typeof input !== 'object' ||
    !('version' in input) ||
    input.version !== 1 ||
    !('trigger' in input) ||
    input.trigger !== 'self' ||
    !('target' in input) ||
    !input.target ||
    typeof input.target !== 'object' ||
    !('kind' in input.target) ||
    input.target.kind !== 'self' ||
    Object.keys(input).some((key) => !['version', 'trigger', 'target'].includes(key)) ||
    Object.keys(input.target).length !== 1
  )
    throw new TypeError('Navigation requires the registered self interaction.');
  const sequence = value.sequence + Number(!value.map);
  if (!Number.isSafeInteger(sequence)) throw new RangeError('Navigation map identity capacity exceeded.');
  const pixels = new Map((value.map?.pixels ?? []).map((pixel) => [`${pixel.x},${pixel.z}`, pixel]));
  for (const pixel of value.pixels) pixels.set(`${pixel.x},${pixel.z}`, pixel);
  const map = validateNavigationItemsCheckpoint({
    version: 1,
    sequence,
    maps: [
      {
        id: value.map?.id ?? `map-${sequence}`,
        playerId: value.actorId,
        center: value.center,
        scale: value.scale,
        pixels: [...pixels.values()].sort((a, b) => a.z - b.z || a.x - b.x),
      },
    ],
  }).maps[0]!;
  return Object.freeze({ version: 1, kind: 'candidate', actorId: value.actorId, sequence, map });
}
