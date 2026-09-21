import { Voxel } from '../../world/voxel';
import type { EntityStore } from './entity-store';

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
}>;

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

const mapColor = (voxel: number) => {
  if (voxel === Voxel.Water) return 1;
  if (voxel === Voxel.Grass || voxel === Voxel.Leaves || voxel === Voxel.Cactus) return 2;
  if (voxel === Voxel.Sand || voxel === Voxel.Sandstone) return 3;
  if (voxel === Voxel.Wood || voxel === Voxel.Planks) return 4;
  if (voxel === Voxel.Lava || voxel === Voxel.Fire || voxel === Voxel.Tnt) return 5;
  return voxel === Voxel.Air ? 0 : 6;
};
const turns = (value: number) => ((value % 1) + 1) % 1;

export class NavigationItemsRuntime {
  #sequence = 0;
  readonly #maps = new Map<string, NavigationMap>();
  constructor(
    private readonly context: Context,
    checkpoint?: NavigationItemsCheckpoint,
  ) {
    this.restore(checkpoint);
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
    const actor = this.context.entities.actorStateAccess(playerId);
    if (actor.inventory.slot(actor.selectedSlot)?.itemId !== 'map')
      return { success: false as const, reason: 'requires-map' };
    const existing = [...this.#maps.values()].find((map) => map.playerId === playerId);
    const center = existing?.center ?? ([Math.floor(entity.position[0]), Math.floor(entity.position[2])] as const);
    const pixels = new Map(
      (existing?.scale === scale ? existing.pixels : []).map((pixel) => [`${pixel.x},${pixel.z}`, pixel]),
    );
    const stride = 1 << scale;
    const y = Math.floor(entity.position[1]);
    for (let z = -4; z <= 4; z++)
      for (let x = -4; x <= 4; x++) {
        const worldX = center[0] + x * stride;
        const worldZ = center[1] + z * stride;
        const voxel = this.context.getLoadedVoxel?.([worldX, y, worldZ]);
        if (voxel !== undefined) pixels.set(`${x},${z}`, Object.freeze({ x, z, color: mapColor(voxel) }));
      }
    const map = copyMap({
      id: existing?.id ?? 'map-' + ++this.#sequence,
      playerId,
      center,
      scale,
      pixels: [...pixels.values()].sort((a, b) => a.z - b.z || a.x - b.x),
    });
    this.#maps.set(playerId, map);
    this.context.changed();
    return { success: true as const, map };
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
    this.#maps.clear();
    for (const map of checkpoint.maps) this.#maps.set(map.playerId, copyMap(map));
  }
}
