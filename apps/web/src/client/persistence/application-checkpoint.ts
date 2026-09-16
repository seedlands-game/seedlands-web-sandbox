import type { FrozenGameSaveSnapshot } from '@seedlands/stdlib/server/persistence/game-save-snapshot';
import type { WorldHarnessPort } from '@seedlands/stdlib/server/harness/world-harness-contract';
import { checkpointHash, inspectResidentCheckpoint } from '../character/resident-checkpoint-transfer';

export type ApplicationCheckpoint = Readonly<{
  format: 'seedlands-application-checkpoint';
  version: 2;
  createdAt: string;
  world: FrozenGameSaveSnapshot;
  worldHash: string;
  cognition: string | null;
  cognitionHash: string | null;
  sourceTimeline: string | null;
  pairHash: string;
}>;
const MAX_APPLICATION_BYTES = 128 * 1024 * 1024;
const snapshotReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Uint16Array || value instanceof Uint8Array)
    return { seedlandsTypedArray: value instanceof Uint16Array ? 'u16' : 'u8', values: Array.from(value) };
  return value;
};
const snapshotReviver = (_key: string, value: unknown): unknown => {
  if (!value || typeof value !== 'object' || !('seedlandsTypedArray' in value)) return value;
  const record = value as { seedlandsTypedArray: unknown; values?: unknown };
  const maximum = record.seedlandsTypedArray === 'u16' ? 65535 : record.seedlandsTypedArray === 'u8' ? 255 : -1;
  if (
    maximum < 0 ||
    Object.keys(record).length !== 2 ||
    !Array.isArray(record.values) ||
    record.values.length > 32768 ||
    record.values.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > maximum)
  )
    throw new Error('世界存档缓冲区无效');
  return maximum === 65535 ? Uint16Array.from(record.values) : Uint8Array.from(record.values);
};
export const encodeApplicationCheckpoint = (checkpoint: ApplicationCheckpoint): string =>
  JSON.stringify(checkpoint, snapshotReplacer);
const jsonHash = (value: unknown) => checkpointHash(new TextEncoder().encode(JSON.stringify(value, snapshotReplacer)));
const HASH = /^[a-f0-9]{64}$/u;
const applicationPairHash = (
  createdAt: string,
  worldHash: string,
  cognitionHash: string | null,
  sourceTimeline: string | null,
) => jsonHash(['seedlands-application-checkpoint-pair', 2, createdAt, worldHash, cognitionHash, sourceTimeline]);

export const applicationCheckpointWorldId = (
  snapshot: Readonly<Pick<FrozenGameSaveSnapshot, 'generatorVersion' | 'seedText'>>,
): string => `seedlands:g${snapshot.generatorVersion}:${snapshot.seedText}`;

const validateWorldIdentity = (world: Record<string, unknown>): void => {
  if (
    typeof world.seedText !== 'string' ||
    !world.seedText.trim() ||
    world.seedText.length > 256 ||
    !Number.isInteger(world.generatorVersion)
  )
    throw new Error('世界存档身份无效');
};

const validatePairPresence = (cognition: unknown, cognitionHash: unknown, sourceTimeline: unknown): void => {
  const empty = cognition === null && cognitionHash === null && sourceTimeline === null;
  const paired =
    typeof cognition === 'string' &&
    HASH.test(String(cognitionHash)) &&
    typeof sourceTimeline === 'string' &&
    sourceTimeline.length > 0 &&
    sourceTimeline.length <= 160;
  if (!empty && !paired) throw new Error('认知存档清单不一致');
};

/** Application commit manifest; world/PG snapshots remain separate owners, never a fictional distributed transaction. */
export async function captureApplicationCheckpoint(
  world: WorldHarnessPort,
  cognition: (() => Promise<string>) | null,
  sourceTimeline: string | null,
): Promise<ApplicationCheckpoint> {
  if ((cognition === null) !== (sourceTimeline === null)) throw new Error('认知存档清单不一致');
  const result = await world.checkpoint({ kind: 'export' });
  if (!result.ok || !result.data.snapshot) throw new Error('世界存档导出失败');
  const memory = cognition ? await cognition() : null;
  const worldHash = await jsonHash(result.data.snapshot);
  const cognitionHash = memory === null ? null : await checkpointHash(new TextEncoder().encode(memory));
  if (memory !== null) {
    const { source } = inspectResidentCheckpoint(memory);
    if (source.worldId !== applicationCheckpointWorldId(result.data.snapshot)) throw new Error('认知存档世界不匹配');
    if (source.timelineId !== sourceTimeline) throw new Error('认知存档时间线不匹配');
  }
  const createdAt = new Date().toISOString();
  return {
    format: 'seedlands-application-checkpoint',
    version: 2,
    createdAt,
    world: result.data.snapshot,
    worldHash,
    cognition: memory,
    cognitionHash,
    sourceTimeline,
    pairHash: await applicationPairHash(createdAt, worldHash, cognitionHash, sourceTimeline),
  };
}

export async function decodeApplicationCheckpoint(raw: string): Promise<ApplicationCheckpoint> {
  if (new TextEncoder().encode(raw).byteLength > MAX_APPLICATION_BYTES) throw new Error('应用存档超出大小限制');
  const value: unknown = JSON.parse(raw, snapshotReviver);
  if (!value || typeof value !== 'object') throw new Error('应用存档格式无效');
  const record = value as Record<string, unknown>;
  if (record.format === 'seedlands-application-checkpoint' && record.version !== 2)
    throw new Error('应用存档版本不受支持');
  if (
    record.format !== 'seedlands-application-checkpoint' ||
    record.version !== 2 ||
    typeof record.createdAt !== 'string' ||
    record.createdAt.length < 1 ||
    record.createdAt.length > 64 ||
    !record.world ||
    typeof record.world !== 'object' ||
    !HASH.test(String(record.worldHash)) ||
    !HASH.test(String(record.pairHash))
  )
    throw new Error('应用存档清单无效');
  validatePairPresence(record.cognition, record.cognitionHash, record.sourceTimeline);
  validateWorldIdentity(record.world as Record<string, unknown>);
  if ((await jsonHash(record.world)) !== record.worldHash) throw new Error('世界存档校验失败');
  if (typeof record.cognition === 'string') {
    if ((await checkpointHash(new TextEncoder().encode(record.cognition))) !== record.cognitionHash)
      throw new Error('认知存档校验失败');
    const { source } = inspectResidentCheckpoint(record.cognition);
    if (source.worldId !== applicationCheckpointWorldId(record.world as FrozenGameSaveSnapshot))
      throw new Error('认知存档世界不匹配');
    if (source.timelineId !== record.sourceTimeline) throw new Error('认知存档时间线不匹配');
  }
  if (
    (await applicationPairHash(
      record.createdAt,
      record.worldHash as string,
      record.cognitionHash as string | null,
      record.sourceTimeline as string | null,
    )) !== record.pairHash
  )
    throw new Error('应用存档配对校验失败');
  return record as ApplicationCheckpoint;
}
