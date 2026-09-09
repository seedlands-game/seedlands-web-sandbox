import { bodyKindForEntity } from '../../physics/body-registry';
import { MAX_LOGIC_TERRAIN_CELLS, type LogicObservation, type TerrainWindow } from '../logic/logic-protocol';
import type { AuthoritySnapshot } from './authority-session';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { ActorState, SimulationSnapshot } from '../simulation/actor-state';
import { getItemDefinition } from '../gameplay/item-registry';
import { CHUNK_SIZE, chunkKey, floorDiv, isSolid } from '../../world/voxel';
import type { CoreClone } from '../../runtime/platform-ports';
import type { GameServer } from '../game-server';

type LoadedVoxel = Readonly<{ voxel: number; chunkKey: string; revision: number }>;

type BuildOptions = Readonly<{
  clone: CoreClone;
  epoch: string;
  observationSequence: number;
  snapshot: AuthoritySnapshot;
  entities: readonly GameplayEntity[];
  simulation: Pick<SimulationSnapshot, 'actors' | 'pois' | 'actions'>;
  identityRevision: (entity: GameplayEntity) => number;
  getLoadedVoxel: (x: number, y: number, z: number) => LoadedVoxel | null;
}>;

type Bounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

const activeActionFor = (simulation: BuildOptions['simulation'], actor: ActorState) =>
  simulation.actions.actions.find(
    (action) => action.actorId === actor.entityId && (action.status === 'pending' || action.status === 'running'),
  ) ?? null;

const terrainBounds = (entities: readonly GameplayEntity[]) => {
  const byChunk = new Map<string, Bounds>();
  entities.forEach((entity) => {
    const cx = floorDiv(entity.position[0], CHUNK_SIZE);
    const cy = floorDiv(entity.position[1], CHUNK_SIZE);
    const cz = floorDiv(entity.position[2], CHUNK_SIZE);
    const key = chunkKey(cx, cy, cz);
    const chunkMinX = cx * CHUNK_SIZE;
    const chunkMinY = cy * CHUNK_SIZE;
    const chunkMinZ = cz * CHUNK_SIZE;
    const x = Math.floor(entity.position[0]);
    const y = Math.floor(entity.position[1]);
    const z = Math.floor(entity.position[2]);
    const next = {
      minX: Math.max(chunkMinX, x - 8),
      maxX: Math.min(chunkMinX + CHUNK_SIZE - 1, x + 8),
      minY: Math.max(chunkMinY, y - 2),
      maxY: Math.min(chunkMinY + CHUNK_SIZE - 1, y + 4),
      minZ: Math.max(chunkMinZ, z - 8),
      maxZ: Math.min(chunkMinZ + CHUNK_SIZE - 1, z + 8),
    };
    const current = byChunk.get(key);
    byChunk.set(
      key,
      current
        ? {
            minX: Math.min(current.minX, next.minX),
            maxX: Math.max(current.maxX, next.maxX),
            minY: Math.min(current.minY, next.minY),
            maxY: Math.max(current.maxY, next.maxY),
            minZ: Math.min(current.minZ, next.minZ),
            maxZ: Math.max(current.maxZ, next.maxZ),
          }
        : next,
    );
  });
  return [...byChunk.entries()].sort(([left], [right]) => left.localeCompare(right));
};

const createTerrainWindow = (
  key: string,
  bounds: Bounds,
  getLoadedVoxel: BuildOptions['getLoadedVoxel'],
): TerrainWindow | null => {
  const size: [number, number, number] = [
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
    bounds.maxZ - bounds.minZ + 1,
  ];
  const occupancy = new Uint8Array(size[0] * size[1] * size[2]);
  let chunkRevision: number | null = null;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1)
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1)
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const loaded = getLoadedVoxel(x, y, z);
        if (!loaded || loaded.chunkKey !== key) return null;
        if (chunkRevision !== null && chunkRevision !== loaded.revision) return null;
        chunkRevision = loaded.revision;
        const localX = x - bounds.minX;
        const localY = y - bounds.minY;
        const localZ = z - bounds.minZ;
        occupancy[localX + size[0] * (localZ + size[2] * localY)] = Number(isSolid(loaded.voxel));
      }
  return {
    key,
    chunkRevision: chunkRevision ?? 0,
    origin: [bounds.minX, bounds.minY, bounds.minZ],
    size,
    occupancy,
  };
};

export function buildLogicObservation(options: BuildOptions): LogicObservation {
  const bodyById = new Map(options.snapshot.entities.map((entry) => [entry.id, entry] as const));
  const identityById = new Map(
    options.entities.map((entity) => [entity.id, options.identityRevision(entity)] as const),
  );
  const actorEntities = options.entities.filter((entity) =>
    options.simulation.actors.some((actor) => actor.entityId === entity.id),
  );
  const terrainWindows: TerrainWindow[] = [];
  let terrainCells = 0;
  for (const [key, bounds] of terrainBounds(actorEntities)) {
    const cells = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) * (bounds.maxZ - bounds.minZ + 1);
    if (terrainCells + cells > MAX_LOGIC_TERRAIN_CELLS) continue;
    const terrainWindow = createTerrainWindow(key, bounds, options.getLoadedVoxel);
    if (!terrainWindow) continue;
    terrainWindows.push(terrainWindow);
    terrainCells += cells;
  }

  return {
    protocolVersion: 1,
    epoch: options.epoch,
    observationSequence: options.observationSequence,
    physicsTick: options.snapshot.physicsTick,
    activeTimeMs: options.snapshot.activeTimeMs,
    worldTime: options.snapshot.worldTime,
    entities: options.entities.map((entity) => {
      const body = bodyById.get(entity.id);
      const item = entity.stack ? getItemDefinition(entity.stack.itemId) : null;
      return {
        id: entity.id,
        bodyKind: bodyKindForEntity(entity),
        identityRevision: identityById.get(entity.id)!,
        poseRevision: options.snapshot.physicsTick,
        position: [...entity.position],
        velocity: body
          ? [body.body.velocity.x, body.body.velocity.y, body.body.velocity.z]
          : [...(entity.physicsVelocity ?? [0, 0, 0])],
        grounded: body?.grounded ?? false,
        ...(entity.health === undefined ? {} : { health: entity.health }),
        ...(entity.stack && item
          ? {
              stack: {
                itemId: entity.stack.itemId,
                count: entity.stack.count,
                edible: item.itemType === 'food',
                hungerRestore: item.hungerRestore ?? 0,
              },
            }
          : {}),
      };
    }),
    decisionContext: {
      actors: options.simulation.actors.map((actor) => ({
        state: options.clone(actor),
        identityRevision: identityById.get(actor.entityId) ?? 0,
        activeAction: activeActionFor(options.simulation, actor),
      })),
      pois: options.clone(options.simulation.pois),
      terrainWindows,
    },
  };
}

/** Maintains identity revisions while building bounded, immutable Logic observations. */
export class AuthorityLogicObservationBuilder {
  private identityRevisionSequence = 0;
  private readonly entityIdentities = new Map<string, { signature: string; revision: number }>();

  constructor(
    private readonly clone: CoreClone,
    private readonly epoch: string,
    private readonly server: GameServer,
  ) {}

  build(sequence: number, snapshot: AuthoritySnapshot): LogicObservation {
    const entities = this.server.queryEntities();
    return buildLogicObservation({
      clone: this.clone,
      epoch: this.epoch,
      observationSequence: sequence,
      snapshot,
      entities,
      simulation: this.server.simulationSnapshot(),
      identityRevision: (entity) => this.identityRevision(entity),
      getLoadedVoxel: (x, y, z) => this.server.peekLoadedVoxel(x, y, z),
    });
  }

  identityRevision(entity: GameplayEntity): number {
    const reference = this.server.createEntityReference(entity.id);
    if (!reference) return 0;
    const signature = `${reference.epoch}:${reference.lifetime}:${entity.type}:${entity.archetype ?? ''}:${entity.stack?.itemId ?? ''}`;
    const current = this.entityIdentities.get(entity.id);
    if (current?.signature === signature) return current.revision;
    const revision = ++this.identityRevisionSequence;
    this.entityIdentities.set(entity.id, { signature, revision });
    return revision;
  }
}
