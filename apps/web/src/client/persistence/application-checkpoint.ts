import type { FrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import type { WorldHarnessPort } from '@seedlands/game-core/server/harness/world-harness-contract';
import { checkpointHash } from '../character/resident-checkpoint-transfer';

export type ApplicationCheckpoint = Readonly<{
  format: 'seedlands-application-checkpoint';
  version: 1;
  createdAt: string;
  world: FrozenGameSaveSnapshot;
  worldHash: string;
  cognition: string | null;
  cognitionHash: string | null;
  sourceTimeline: string | null;
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

/** Application commit manifest; world/PG snapshots remain separate owners, never a fictional distributed transaction. */
export async function captureApplicationCheckpoint(
  world: WorldHarnessPort,
  cognition: (() => Promise<string>) | null,
  sourceTimeline: string | null,
): Promise<ApplicationCheckpoint> {
  const result = await world.checkpoint({ kind: 'export' });
  if (!result.ok || !result.data.snapshot) throw new Error('世界存档导出失败');
  const memory = cognition ? await cognition() : null;
  return {
    format: 'seedlands-application-checkpoint',
    version: 1,
    createdAt: new Date().toISOString(),
    world: result.data.snapshot,
    worldHash: await jsonHash(result.data.snapshot),
    cognition: memory,
    cognitionHash: memory === null ? null : await checkpointHash(new TextEncoder().encode(memory)),
    sourceTimeline,
  };
}

export async function decodeApplicationCheckpoint(raw: string): Promise<ApplicationCheckpoint> {
  if (new TextEncoder().encode(raw).byteLength > MAX_APPLICATION_BYTES) throw new Error('应用存档超出大小限制');
  const value: unknown = JSON.parse(raw, snapshotReviver);
  if (!value || typeof value !== 'object') throw new Error('应用存档格式无效');
  const record = value as Record<string, unknown>;
  if (
    record.format !== 'seedlands-application-checkpoint' ||
    record.version !== 1 ||
    !record.world ||
    typeof record.world !== 'object' ||
    typeof record.worldHash !== 'string' ||
    (record.cognition !== null && typeof record.cognition !== 'string') ||
    (record.sourceTimeline !== null && typeof record.sourceTimeline !== 'string')
  )
    throw new Error('应用存档清单无效');
  if ((await jsonHash(record.world)) !== record.worldHash) throw new Error('世界存档校验失败');
  if (
    typeof record.cognition === 'string' &&
    (await checkpointHash(new TextEncoder().encode(record.cognition))) !== record.cognitionHash
  )
    throw new Error('认知存档校验失败');
  if (record.cognition === null && record.cognitionHash !== null) throw new Error('认知存档清单不一致');
  return record as ApplicationCheckpoint;
}
