export type GameSaveCheckpoint = Readonly<{ commitSequence: number; worldRevision: number }>;

export function readGameSaveCheckpoint(value: unknown): GameSaveCheckpoint | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new TypeError('持久检查点格式无效。');
  const checkpoint = value as Partial<GameSaveCheckpoint>;
  if (
    !Number.isSafeInteger(checkpoint.commitSequence) ||
    checkpoint.commitSequence! < 0 ||
    !Number.isSafeInteger(checkpoint.worldRevision) ||
    checkpoint.worldRevision! < 0
  )
    throw new TypeError('持久检查点的提交序号和世界修订号必须是非负安全整数。');
  return { commitSequence: checkpoint.commitSequence!, worldRevision: checkpoint.worldRevision! };
}
