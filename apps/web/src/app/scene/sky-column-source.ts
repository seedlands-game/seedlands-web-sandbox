import { CHUNK_SIZE, chunkKey, floorDiv } from '@seedlands/stdlib/world/voxel';
import type { WorldInspectResult } from '@seedlands/stdlib/server/harness/world-harness-contract';
import type { WorldAuthorityPort } from '../world/world-authority-port';
import {
  SKY_VISIBILITY_MAX_COLUMN_HEIGHT,
  type SkyColumnObstructionSample,
  type SkyVisibilityDependency,
} from './sky-visibility-volume';

export type SkyColumnSource = Extract<WorldInspectResult, { kind: 'column-source' }>['source'];
export type SkyVoxelReader = Pick<WorldAuthorityPort, 'getChunkRevision' | 'getVoxel' | 'voxelSemantics'>;
export type SkyColumnProof = Readonly<{
  ceilingY: number;
  dependencies: readonly SkyVisibilityDependency[];
  columns: readonly SkyColumnObstructionSample[];
}>;

/** The ceiling closes this observation; it is never a world height or a truncation of unknown cells. */
function* skyColumnProofSteps(
  source: SkyColumnSource,
  chunk: readonly [number, number, number],
  reader: SkyVoxelReader,
): Generator<SkyColumnObstructionSample, SkyColumnProof | null> {
  if (
    source.status !== 'complete' ||
    source.cx !== chunk[0] ||
    source.cz !== chunk[2] ||
    source.entries.length > 128 ||
    !chunk.every(Number.isSafeInteger)
  )
    return null;
  const [cx, cy, cz] = chunk;
  const bottomY = cy * CHUNK_SIZE;
  const rows = new Map(source.entries.map((entry) => [entry.key, entry]));
  if (rows.size !== source.entries.length || !Number.isSafeInteger(source.generatedEmptyAboveY)) return null;
  let ceilingY = Math.max(bottomY + CHUNK_SIZE - 1, source.generatedEmptyAboveY);
  for (const entry of source.entries) {
    if (
      entry.cx !== cx ||
      entry.cz !== cz ||
      ![entry.cy, entry.revision].every(Number.isSafeInteger) ||
      entry.revision < 0 ||
      entry.key !== chunkKey(cx, entry.cy, cz)
    )
      return null;
    if (entry.cy >= cy) ceilingY = Math.max(ceilingY, entry.cy * CHUNK_SIZE + CHUNK_SIZE - 1);
  }
  const count = ceilingY - bottomY + 1;
  if (
    ![bottomY, ceilingY, cx * CHUNK_SIZE, cx * CHUNK_SIZE + 31, cz * CHUNK_SIZE, cz * CHUNK_SIZE + 31].every(
      Number.isSafeInteger,
    ) ||
    count > SKY_VISIBILITY_MAX_COLUMN_HEIGHT ||
    count < CHUNK_SIZE
  )
    return null;
  const dependencies: SkyVisibilityDependency[] = [];
  for (let cursor = cy; cursor <= floorDiv(ceilingY, CHUNK_SIZE); cursor++) {
    const key = chunkKey(cx, cursor, cz);
    const entry = rows.get(key);
    const revision = reader.getChunkRevision(cx, cursor, cz);
    const needsVoxels = cursor * CHUNK_SIZE <= source.generatedEmptyAboveY || Boolean(entry);
    if (needsVoxels || cursor === cy || revision !== null) {
      if (revision === null || revision !== (entry?.revision ?? 0)) return null;
      dependencies.push({ key, resident: true, revision });
    }
  }
  const columns: SkyColumnObstructionSample[] = [];
  for (let localZ = 0; localZ < CHUNK_SIZE; localZ++)
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      const obstruction = new Uint8Array(count);
      const loaded = new Uint8Array(count);
      for (let offset = 0; offset < count; offset++) {
        const y = bottomY + offset;
        if (y > source.generatedEmptyAboveY && !rows.has(chunkKey(cx, floorDiv(y, CHUNK_SIZE), cz))) {
          loaded[offset] = 2; // Authoritative absent-directory plus producer guarantee, not resident data.
          continue;
        }
        const definition = reader.voxelSemantics.get(
          reader.getVoxel(cx * CHUNK_SIZE + localX, y, cz * CHUNK_SIZE + localZ),
        );
        if (
          !definition ||
          !Number.isInteger(definition.lightCost) ||
          definition.lightCost < 1 ||
          definition.lightCost > 16
        )
          return null;
        loaded[offset] = 1;
        obstruction[offset] = Math.round(((definition.lightCost - 1) * 255) / 15);
      }
      const column = { localX, localZ, bottomY, obstruction, loaded };
      columns.push(column);
      yield column;
    }
  return { ceilingY, dependencies, columns };
}

/** Synchronous pure API; production uses the cancellable task consumer below. */
export function readSkyColumnProof(
  source: SkyColumnSource,
  chunk: readonly [number, number, number],
  reader: SkyVoxelReader,
): SkyColumnProof | null {
  const steps = skyColumnProofSteps(source, chunk, reader);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export const SKY_PROOF_COLUMNS_PER_TASK = 8;
export const SKY_PROOF_MAX_VOXEL_READS_PER_TASK = SKY_PROOF_COLUMNS_PER_TASK * SKY_VISIBILITY_MAX_COLUMN_HEIGHT;

export type SkyProofTaskOptions = Readonly<{
  isCurrent(): boolean;
  yieldTask?: () => Promise<void>;
}>;

const yieldSkyProofTask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

/** No partial publication; each real task reads at most eight bounded columns. */
export async function readSkyColumnProofByTask(
  source: SkyColumnSource,
  chunk: readonly [number, number, number],
  reader: SkyVoxelReader,
  options: SkyProofTaskOptions,
): Promise<SkyColumnProof | null> {
  if (!options.isCurrent()) return null;
  const steps = skyColumnProofSteps(source, chunk, reader);
  try {
    let step = steps.next();
    let columns = 0;
    while (!step.done) {
      if (++columns === SKY_PROOF_COLUMNS_PER_TASK) {
        await (options.yieldTask ?? yieldSkyProofTask)();
        columns = 0;
        if (!options.isCurrent()) return null;
      }
      step = steps.next();
    }
    return options.isCurrent() ? step.value : null;
  } finally {
    steps.return(null);
  }
}
