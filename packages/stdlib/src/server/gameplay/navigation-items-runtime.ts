import type { EntityStore } from './entity-store';
import type { RegisteredStatePort } from '../composition/operation-contracts';
import type { WorldComposition } from '../composition/contracts';
import {
  buildNavigationCandidate,
  type NavigationInteractionConfig,
  type NavigationObservationV1,
} from './modules/navigation-interaction-model';
import { createNavigationStatePort } from './modules/navigation-state-port';

export type MapPixel = Readonly<{ x: number; z: number; color: number }>;
export type NavigationMap = Readonly<{
  id: string;
  playerId: string;
  center: readonly [number, number];
  scale: number;
  pixels: readonly MapPixel[];
}>;
export type NavigationItemsCheckpoint = Readonly<{ version: 1; sequence: number; maps: readonly NavigationMap[] }>;
type Context = Readonly<{
  entities: EntityStore;
  getWorldTime(): number;
  getLoadedVoxel?(position: [number, number, number]): number | undefined;
  changed(): void;
  assertCanChange(): void;
  composition?: WorldComposition;
  config?: NavigationInteractionConfig;
}>;

export type NavigationHeldProjectionV1 = Readonly<{ itemId: string; slot: number }> &
  (
    | Readonly<{ kind: 'map'; revision: number; map: NavigationMap | null }>
    | Readonly<{ kind: 'compass'; target: readonly [number, number, number]; turns: number }>
    | Readonly<{ kind: 'clock'; worldTime: number; phase: number }>
  );

const copyMap = (map: NavigationMap): NavigationMap =>
  Object.freeze({
    ...map,
    center: Object.freeze([map.center[0], map.center[1]] as const),
    pixels: Object.freeze(map.pixels.map((pixel) => Object.freeze({ ...pixel }))),
  });

export function validateNavigationItemsCheckpoint(
  value: NavigationItemsCheckpoint = { version: 1, sequence: 0, maps: [] },
): NavigationItemsCheckpoint {
  if (value.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.maps))
    throw new TypeError('Navigation items checkpoint is invalid.');
  const ids = new Set<string>();
  const players = new Set<string>();
  const maps = value.maps.map((map) => {
    const identity = /^map-(\d+)$/.exec(map.id ?? '');
    if (
      !identity ||
      Number(identity[1]) > value.sequence ||
      ids.has(map.id) ||
      !map.playerId?.trim() ||
      players.has(map.playerId) ||
      map.center.length !== 2 ||
      !map.center.every(Number.isSafeInteger) ||
      !Number.isSafeInteger(map.scale) ||
      map.scale < 0 ||
      map.scale > 4 ||
      !Array.isArray(map.pixels)
    )
      throw new TypeError('Navigation map is invalid.');
    const coordinates = new Set<string>();
    for (const pixel of map.pixels) {
      const coordinate = `${pixel.x},${pixel.z}`;
      if (
        !Number.isSafeInteger(pixel.x) ||
        !Number.isSafeInteger(pixel.z) ||
        Math.abs(pixel.x) > 4 ||
        Math.abs(pixel.z) > 4 ||
        !Number.isSafeInteger(pixel.color) ||
        pixel.color < 0 ||
        pixel.color > 15 ||
        coordinates.has(coordinate)
      )
        throw new TypeError('Navigation map pixel is invalid.');
      coordinates.add(coordinate);
    }
    ids.add(map.id);
    players.add(map.playerId);
    return copyMap(map);
  });
  return Object.freeze({ version: 1, sequence: value.sequence, maps: Object.freeze(maps) });
}

export function validateNavigationMapPlayers(value: NavigationItemsCheckpoint | undefined, entities: EntityStore) {
  for (const map of value?.maps ?? [])
    if (entities.get(map.playerId)?.type !== 'player') throw new TypeError('Navigation map player is invalid.');
}

export function navigationCheckpointFromSnapshot(source: unknown, entities: EntityStore) {
  if (!source || typeof source !== 'object' || !('version' in source) || source.version !== 4) return undefined;
  if (!('navigationItems' in source) || !source.navigationItems) return undefined;
  const checkpoint = validateNavigationItemsCheckpoint(source.navigationItems as NavigationItemsCheckpoint);
  validateNavigationMapPlayers(checkpoint, entities);
  return checkpoint;
}

const turns = (value: number) => ((value % 1) + 1) % 1;

export class NavigationItemsRuntime {
  #sequence = 0;
  #revision = 0;
  #lifetime = {};
  readonly #maps = new Map<string, NavigationMap>();
  readonly state: RegisteredStatePort;
  constructor(
    private readonly context: Context,
    checkpoint?: NavigationItemsCheckpoint,
  ) {
    this.restore(checkpoint);
    this.state = createNavigationStatePort({
      config: context.config,
      composition: context.composition,
      revision: () => this.#revision,
      lifetime: () => this.#lifetime,
      actorLifetime: (id) => context.entities.createReference(id),
      project: (id) => this.projectUse(id),
      assertCanChange: context.assertCanChange,
      accept: (candidate) => {
        this.#maps.set(candidate.actorId, candidate.map);
        this.#sequence = candidate.sequence;
        this.#revision++;
        context.changed();
      },
    });
  }

  private selectedItem(playerId: string): Readonly<{ itemId: string | null; slot: number }> {
    const actor = this.context.entities.actorStateAccess(playerId);
    const components = this.context.entities.actorComponentSnapshot(playerId);
    const creative = components.mode?.value === 'creative';
    const slot = creative ? (components.creativeCatalog?.selectedSlot ?? actor.selectedSlot) : actor.selectedSlot;
    return {
      slot,
      itemId: creative
        ? (components.creativeCatalog?.hotbar[slot] ?? null)
        : (actor.inventory.slot(slot)?.itemId ?? null),
    };
  }

  held(playerId: string): NavigationHeldProjectionV1 | null {
    const policy = this.context.config?.policy;
    if (
      !policy ||
      this.context.entities.get(playerId)?.type !== 'player' ||
      this.context.entities.actorStateAccess(playerId).lifecycle !== 'alive'
    )
      return null;
    const selected = this.selectedItem(playerId);
    if (selected.itemId === policy.mapItemId)
      return Object.freeze({
        ...selected,
        itemId: policy.mapItemId,
        kind: 'map',
        revision: this.#revision,
        map: this.#maps.has(playerId) ? copyMap(this.#maps.get(playerId)!) : null,
      });
    if (selected.itemId === policy.compassItemId)
      return Object.freeze({ ...selected, itemId: policy.compassItemId, kind: 'compass', ...this.compass(playerId) });
    if (selected.itemId === policy.clockItemId)
      return Object.freeze({ ...selected, itemId: policy.clockItemId, kind: 'clock', ...this.clock() });
    return null;
  }

  private projectUse(playerId: string, scale?: number): NavigationObservationV1 {
    const policy = this.context.config?.policy,
      entity = this.context.entities.get(playerId);
    if (!policy || entity?.type !== 'player') throw new Error('Navigation requires its configured player owner.');
    const existing = this.#maps.get(playerId);
    const center = existing?.center ?? ([Math.floor(entity.position[0]), Math.floor(entity.position[2])] as const);
    const mapScale = scale ?? existing?.scale ?? 0;
    if (!Number.isSafeInteger(mapScale) || mapScale < 0 || mapScale > 4)
      throw new TypeError('Navigation scale is invalid.');
    const pixels: MapPixel[] = [],
      palette = new Map(policy.palette.map(({ voxel, color }) => [voxel, color]));
    for (let z = -policy.windowRadius; z <= policy.windowRadius; z++)
      for (let x = -policy.windowRadius; x <= policy.windowRadius; x++) {
        const voxel = this.context.getLoadedVoxel?.([
          center[0] + x * (1 << mapScale),
          Math.floor(entity.position[1]) + policy.sampleYOffset,
          center[1] + z * (1 << mapScale),
        ]);
        if (voxel !== undefined)
          pixels.push(Object.freeze({ x, z, color: palette.get(voxel) ?? policy.fallbackColor }));
      }
    return Object.freeze({
      version: 1,
      kind: 'observation',
      actorId: playerId,
      alive: this.context.entities.actorStateAccess(playerId).lifecycle === 'alive',
      selectedItemId: this.selectedItem(playerId).itemId,
      sequence: this.#sequence,
      center: Object.freeze([...center] as [number, number]),
      scale: mapScale,
      map: existing
        ? copyMap({ ...existing, scale: mapScale, pixels: existing.scale === mapScale ? existing.pixels : [] })
        : null,
      pixels: Object.freeze(pixels),
    });
  }
  compass(playerId: string) {
    const entity = this.context.entities.get(playerId);
    if (entity?.type !== 'player') throw new Error('Compass requires a player.');
    const target = this.context.entities.playerStateAccess(playerId).spawnPosition;
    const dx = target[0] - entity.position[0];
    const dz = target[2] - entity.position[2];
    return Object.freeze({
      target: Object.freeze([...target] as [number, number, number]),
      turns: dx === 0 && dz === 0 ? 0 : turns(Math.atan2(dz, dx) / (Math.PI * 2)),
    });
  }
  clock() {
    const worldTime = this.context.getWorldTime();
    if (!Number.isFinite(worldTime)) throw new TypeError('World time is invalid.');
    return Object.freeze({ worldTime, phase: turns(worldTime / 24) });
  }
  explore(playerId: string, scale = 0) {
    const entity = this.context.entities.get(playerId);
    if (entity?.type !== 'player' || !Number.isSafeInteger(scale) || scale < 0 || scale > 4)
      return { success: false as const, reason: 'invalid-map-request' };
    const policy = this.context.config?.policy;
    if (!policy || this.selectedItem(playerId).itemId !== policy.mapItemId)
      return { success: false as const, reason: 'requires-map' };
    this.context.assertCanChange();
    const candidate = buildNavigationCandidate(this.projectUse(playerId, scale), policy, {
      version: 1,
      trigger: 'self',
      target: { kind: 'self' },
    });
    this.#maps.set(playerId, candidate.map);
    this.#sequence = candidate.sequence;
    this.#revision++;
    this.context.changed();
    return { success: true as const, map: candidate.map };
  }
  list(): readonly NavigationMap[] {
    return Object.freeze([...this.#maps.values()].sort((a, b) => a.id.localeCompare(b.id)).map(copyMap));
  }
  checkpoint(): NavigationItemsCheckpoint {
    return validateNavigationItemsCheckpoint({ version: 1, sequence: this.#sequence, maps: this.list() });
  }
  restore(value?: NavigationItemsCheckpoint) {
    const checkpoint = validateNavigationItemsCheckpoint(value);
    for (const map of checkpoint.maps)
      if (this.context.entities.get(map.playerId)?.type !== 'player')
        throw new TypeError('Navigation map player is invalid.');
    this.#sequence = checkpoint.sequence;
    this.#revision = 0;
    this.#lifetime = {};
    this.#maps.clear();
    for (const map of checkpoint.maps) this.#maps.set(map.playerId, copyMap(map));
  }
}
