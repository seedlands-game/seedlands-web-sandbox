import type { WorldEditBatch } from './game-server-types';
import type { StationStateCodec } from './gameplay/ecs-station-state';
import type { EntityStore } from './gameplay/entity-store';

/** Raw developer edits cannot bypass station inventory and lifetime transactions. */
export function assertNoRawStationEdits(
  batch: WorldEditBatch,
  codec: StationStateCodec | undefined,
  entities: EntityStore,
  getVoxel: (x: number, y: number, z: number) => number,
): void {
  if (!codec) return;
  const check = (x: number, y: number, z: number, value: number) => {
    const previous = getVoxel(x, y, z);
    if (
      previous !== value &&
      (codec.kindForVoxel(previous) || codec.kindForVoxel(value) || entities.stationAt([x, y, z]))
    )
      throw new TypeError('Station voxels require a station-aware Block transaction.');
  };
  batch.edits?.forEach(({ x, y, z, value }) => check(x, y, z, value));
  batch.buffers?.forEach((buffer) => buffer.forEach(check));
}

/** Validate against the candidate checkpoint bytes, never the live world's terrain. */
export function assertStationCheckpointIntegrity(
  snapshot: import('./persistence/game-save-snapshot').FrozenGameSaveSnapshot,
  codec: StationStateCodec | undefined,
): void {
  const owner = snapshot.gameplay.entityStore;
  const components = owner.version === 2 ? owner.stations : [];
  if (!codec) {
    if (components.length || owner.entities.some((entity) => entity.type === 'station'))
      throw new TypeError('Checkpoint has stations without station content.');
    return;
  }
  const byId = new Map(owner.entities.map((entity) => [entity.id, entity]));
  const expected = new Map<string, number>();
  for (const source of components) {
    const component = codec.decode(source),
      entity = byId.get(component.entityId);
    if (!entity || entity.type !== 'station' || !entity.position.every(Number.isInteger))
      throw new TypeError('Checkpoint station entity is invalid.');
    const key = entity.position.join(',');
    if (expected.has(key)) throw new TypeError('Checkpoint station positions collide.');
    expected.set(key, component.voxel);
  }
  if (owner.entities.filter((entity) => entity.type === 'station').length !== components.length)
    throw new TypeError('Checkpoint station components are missing.');
  for (const chunk of snapshot.chunks) {
    for (let index = 0; index < chunk.voxels.length; index++) {
      const voxel = chunk.voxels[index];
      if (!codec.kindForVoxel(voxel)) continue;
      const x = chunk.cx * 32 + (index % 32),
        z = chunk.cz * 32 + (Math.floor(index / 32) % 32),
        y = chunk.cy * 32 + Math.floor(index / 1024);
      const key = `${x},${y},${z}`;
      if (expected.get(key) !== voxel) throw new TypeError('Checkpoint station voxel has no matching entity.');
      expected.delete(key);
    }
  }
  if (expected.size) throw new TypeError('Checkpoint station entity has no matching voxel.');
}

export function stationChunkKeys(entities: EntityStore): Set<string> {
  return new Set(
    entities.queryStations().map((entity) => entity.position.map((value) => Math.floor(value / 32)).join(',')),
  );
}

export function assertStationChunkIntegrity(
  chunk: Readonly<{ cx: number; cy: number; cz: number; voxels: Uint16Array }>,
  codec: StationStateCodec | undefined,
  entities: EntityStore,
): void {
  if (!codec) return;
  const expected = new Map<number, number>();
  for (const entity of entities.queryStations()) {
    const [x, y, z] = entity.position;
    if (Math.floor(x / 32) !== chunk.cx || Math.floor(y / 32) !== chunk.cy || Math.floor(z / 32) !== chunk.cz) continue;
    expected.set(
      x - chunk.cx * 32 + (z - chunk.cz * 32) * 32 + (y - chunk.cy * 32) * 1024,
      entities.stationSnapshot(entity.id)!.voxel,
    );
  }
  for (let index = 0; index < chunk.voxels.length; index++) {
    const voxel = chunk.voxels[index];
    if (codec.kindForVoxel(voxel)) {
      if (expected.get(index) !== voxel) throw new TypeError('Persisted station voxel has no matching entity.');
      expected.delete(index);
    }
  }
  if (expected.size) throw new TypeError('Persisted station entity has no matching voxel.');
}
