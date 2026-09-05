import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import type { AuthorityAction } from '../../worker/authority-worker-protocol';
import type { CommandSource, ServerCommand } from '../commands/command-contract';
import type { WorldCommitResult } from '../game-server-types';
import type { WorldMutationBuffer, VoxelEdit } from '../world-mutation';
import { assertMutationCoordinate, assertVoxelValue } from '../world-mutation';

const PREPARATION_TIMEOUT_MS = 5_000;
const MAX_PREPARED_CHUNKS = 2_048;

type EntityPosition = Readonly<{ position: readonly [number, number, number] }>;
type PreparationServer = Readonly<{
  worldRevision: number;
  prepareCanonicalChunkForMutation(cx: number, cy: number, cz: number): Promise<boolean>;
  getEntity(id: string): EntityPosition | null;
}>;
type PendingPreparation = {
  promise: Promise<boolean>;
  resolve: (available: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const keyForPosition = (position: readonly [number, number, number]): string => {
  position.forEach(assertMutationCoordinate);
  return chunkKey(
    floorDiv(position[0], CHUNK_SIZE),
    floorDiv(position[1], CHUNK_SIZE),
    floorDiv(position[2], CHUNK_SIZE),
  );
};

const withinRange = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  range: number,
) => left.reduce((distance, value, axis) => distance + (value - right[axis]) ** 2, 0) <= range ** 2;

const chunkCoordinates = (key: string): [number, number, number] => {
  const coordinates = key.split(',').map(Number);
  if (coordinates.length !== 3 || !coordinates.every(Number.isInteger))
    throw new TypeError(`Invalid canonical Chunk key: ${key}.`);
  return coordinates as [number, number, number];
};

const addSegmentKeys = (
  keys: Set<string>,
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) => {
  const from = left.map((value) => floorDiv(Math.floor(value), CHUNK_SIZE));
  const to = right.map((value) => floorDiv(Math.floor(value), CHUNK_SIZE));
  for (let cy = Math.min(from[1], to[1]); cy <= Math.max(from[1], to[1]); cy += 1)
    for (let cz = Math.min(from[2], to[2]); cz <= Math.max(from[2], to[2]); cz += 1)
      for (let cx = Math.min(from[0], to[0]); cx <= Math.max(from[0], to[0]); cx += 1) keys.add(chunkKey(cx, cy, cz));
};

export class AuthorityMutationPreparation {
  private readonly pending = new Map<string, PendingPreparation>();

  constructor(
    private readonly server: PreparationServer,
    private readonly requestChunk: (key: string) => void,
  ) {}

  async prepareEdits(edits: readonly VoxelEdit[]): Promise<boolean> {
    const keys = new Set<string>();
    edits.forEach(({ x, y, z, value }) => {
      assertMutationCoordinate(x);
      assertMutationCoordinate(y);
      assertMutationCoordinate(z);
      assertVoxelValue(value);
      keys.add(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
    });
    return this.prepareKeys(keys);
  }

  prepareAction(action: AuthorityAction, playerId: string): Promise<boolean> {
    const keys = new Set<string>();
    if (action.type === 'place' || action.type === 'begin-break')
      this.addVoxelTarget(keys, playerId, action.position, 5);
    if (action.type === 'attack') this.addEntitySegment(keys, playerId, action.targetId, 3);
    return this.prepareKeys(keys);
  }

  prepareCommand(
    source: CommandSource,
    command: ServerCommand,
    mutationBuffer?: WorldMutationBuffer,
  ): Promise<boolean> {
    const keys = new Set<string>();
    mutationBuffer?.forEach((x, y, z) =>
      keys.add(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))),
    );
    if (command.type === 'inspect-voxel') keys.add(keyForPosition(command.position));
    else if (command.type === 'break-voxel' || command.type === 'place-voxel')
      this.addVoxelTarget(keys, source.entityId ?? source.actorId, command.position, 5);
    else if (command.type === 'inspect-chunk') keys.add(chunkKey(...command.chunk));
    else if (command.type === 'attack-entity')
      this.addEntitySegment(keys, source.entityId ?? source.actorId, command.entityId, 3);
    else if (command.type === 'pickup-item')
      this.addEntitySegment(keys, source.entityId ?? source.actorId, command.entityId, 1.5);
    return this.prepareKeys(keys);
  }

  acceptAvailable(key: string): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(key);
    pending.resolve(true);
  }

  private async prepareKeys(keys: ReadonlySet<string>): Promise<boolean> {
    if (!keys.size) return true;
    if (keys.size > MAX_PREPARED_CHUNKS)
      throw new RangeError(`Authority mutation touches more than ${MAX_PREPARED_CHUNKS} Chunk(s).`);
    const prepared = await Promise.all(
      [...keys].sort().map(async (key) => {
        const [cx, cy, cz] = chunkCoordinates(key);
        return (await this.server.prepareCanonicalChunkForMutation(cx, cy, cz)) || this.waitForChunk(key);
      }),
    );
    return prepared.every(Boolean);
  }

  private waitForChunk(key: string): Promise<boolean> {
    const existing = this.pending.get(key);
    if (existing) return existing.promise;
    let resolve!: (available: boolean) => void;
    const promise = new Promise<boolean>((complete) => (resolve = complete));
    const timeout = setTimeout(() => {
      if (this.pending.get(key)?.promise !== promise) return;
      this.pending.delete(key);
      resolve(false);
    }, PREPARATION_TIMEOUT_MS);
    this.pending.set(key, { promise, resolve, timeout });
    this.requestChunk(key);
    return promise;
  }

  private addVoxelTarget(
    keys: Set<string>,
    sourceId: string,
    position: readonly [number, number, number],
    range: number,
  ): void {
    const key = keyForPosition(position);
    const source = this.server.getEntity(sourceId);
    const center: [number, number, number] = [position[0] + 0.5, position[1] + 0.5, position[2] + 0.5];
    if (source && withinRange(source.position, center, range)) keys.add(key);
  }

  private addEntitySegment(keys: Set<string>, sourceId: string, targetId: string, range: number): void {
    const source = this.server.getEntity(sourceId);
    const target = this.server.getEntity(targetId);
    if (source && target && withinRange(source.position, target.position, range))
      addSegmentKeys(keys, source.position, target.position);
  }
}

export const unavailableWorldCommit = (worldRevision: number, inputMutationCount: number): WorldCommitResult => ({
  committed: false,
  reason: 'chunk-unavailable',
  worldRevision,
  structuralChange: null,
  semanticEvents: [],
  metrics: {
    timingStatus: 'not-collected-hot-path',
    inputMutationCount,
    canonicalWriteCount: 0,
    dirtyChunkCount: 0,
    meshInvalidationCount: 0,
    structuralEventCount: 0,
    semanticEventCount: 0,
    mutationPayloadBytes: 0,
    mutationCapacityBytes: 0,
    validationMs: 0,
    resolveMs: 0,
    applyMs: 0,
    commitMs: 0,
  },
});
