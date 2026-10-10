import { CHUNK_SIZE, chunkKey } from '../world/voxel';
import type { ChunkColumnDirectory, ChunkPersistence } from './persistence/chunk-persistence';
import type { StandardWorldgenProvider } from './worldgen/standard-worldgen-module';
import type { ServerChunk } from './game-server-types';

type Entry = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
  revision: number;
  resident: boolean;
  dirty: boolean;
}>;
type Unknown = Extract<ChunkColumnDirectory, { status: 'unknown' }>;
export type ServerColumnSource =
  | Unknown
  | Readonly<{
      status: 'complete';
      cx: number;
      cz: number;
      epoch: number;
      worldRevision: number;
      directoryRevision: number;
      generatedEmptyAboveY: number;
      entries: readonly Entry[];
    }>;
type State = Readonly<{ epoch: number; worldRevision: number; chunks: ReadonlyMap<string, ServerChunk> }>;
type Options = Readonly<{
  seed: number;
  generatorVersion: number;
  provider?: StandardWorldgenProvider;
  persistence?: ChunkPersistence;
  state(): State;
}>;
const unknown = (reason: Unknown['reason']): Unknown => ({ status: 'unknown', reason });
const revisionValid = (value: number) => Number.isSafeInteger(value) && value >= 0;
const isUnknown = (value: readonly Entry[] | Unknown): value is Unknown => !Array.isArray(value);

function residents(state: State, cx: number, cz: number): readonly Entry[] | Unknown {
  if (state.chunks.size > 1024) return unknown('budget-exhausted');
  const entries: Entry[] = [];
  for (const [key, record] of state.chunks) {
    if (
      ![record.cx, record.cy, record.cz].every(Number.isSafeInteger) ||
      key !== record.key ||
      key !== chunkKey(record.cx, record.cy, record.cz) ||
      !revisionValid(record.revision) ||
      !revisionValid(record.persistedRevision) ||
      typeof record.dirty !== 'boolean'
    )
      return unknown('invalid-data');
    if (record.cx !== cx || record.cz !== cz) continue;
    if (entries.length === 128) return unknown('budget-exhausted');
    entries.push({ key, cx, cy: record.cy, cz, revision: record.revision, resident: true, dirty: record.dirty });
  }
  return entries.sort((a, b) => a.cy - b.cy);
}

/** Metadata-only observation of the same canonical owner; no generated or persisted payload reads. */
export async function inspectServerColumnSource(options: Options, cx: number, cz: number): Promise<ServerColumnSource> {
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) throw new RangeError('Column coordinates are invalid.');
  const producer = options.provider?.generatedEmptyAboveY;
  if (!options.provider || !producer || !options.persistence?.inspectColumnDirectory)
    return unknown('source-unavailable');
  if (!options.provider.identity.supportedGeneratorVersions.includes(options.generatorVersion))
    return unknown('source-unavailable');
  const before = options.state();
  const initial = residents(before, cx, cz);
  if (isUnknown(initial)) return initial;
  const x = cx * CHUNK_SIZE,
    z = cz * CHUNK_SIZE;
  if (![x, z, x + CHUNK_SIZE - 1, z + CHUNK_SIZE - 1].every(Number.isSafeInteger)) return unknown('invalid-data');
  let generatedEmptyAboveY = -Infinity;
  for (let localZ = 0; localZ < CHUNK_SIZE; localZ++)
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      let bound: number | null;
      try {
        bound = producer.call(
          options.provider,
          Object.freeze({
            seed: options.seed,
            generatorVersion: options.generatorVersion,
            x: x + localX,
            z: z + localZ,
          }),
        );
      } catch {
        return unknown('invalid-data');
      }
      if (bound === null) return unknown('source-unavailable');
      if (!Number.isSafeInteger(bound)) return unknown('invalid-data');
      generatedEmptyAboveY = Math.max(generatedEmptyAboveY, bound);
    }
  const directory = await options.persistence.inspectColumnDirectory(cx, cz);
  const after = options.state();
  const current = residents(after, cx, cz);
  if (
    before.epoch !== after.epoch ||
    before.worldRevision !== after.worldRevision ||
    producer !== options.provider?.generatedEmptyAboveY ||
    JSON.stringify(initial) !== JSON.stringify(current)
  )
    return unknown('superseded');
  if (isUnknown(current)) return current;
  if (!directory || typeof directory !== 'object') return unknown('invalid-data');
  if (directory.status === 'unknown')
    return ['source-unavailable', 'invalid-data', 'budget-exhausted', 'superseded'].includes(directory.reason)
      ? unknown(directory.reason)
      : unknown('invalid-data');
  if (
    directory.status !== 'complete' ||
    !revisionValid(directory.revision) ||
    !Array.isArray(directory.entries) ||
    directory.entries.length > 128
  )
    return unknown('invalid-data');
  const merged = new Map<string, Entry>();
  for (const row of directory.entries) {
    if (
      !row ||
      typeof row !== 'object' ||
      row.cx !== cx ||
      row.cz !== cz ||
      !Number.isSafeInteger(row.cy) ||
      row.key !== chunkKey(cx, row.cy, cz) ||
      !revisionValid(row.revision) ||
      merged.has(row.key)
    )
      return unknown('invalid-data');
    merged.set(row.key, { key: row.key, cx, cy: row.cy, cz, revision: row.revision, resident: false, dirty: false });
  }
  for (const row of current) {
    const persisted = merged.get(row.key);
    if (persisted && persisted.revision > row.revision) return unknown('invalid-data');
    merged.set(row.key, row);
  }
  if (merged.size > 128) return unknown('budget-exhausted');
  return {
    status: 'complete',
    cx,
    cz,
    epoch: after.epoch,
    worldRevision: after.worldRevision,
    directoryRevision: directory.revision,
    generatedEmptyAboveY,
    entries: [...merged.values()].sort((a, b) => a.cy - b.cy),
  };
}
