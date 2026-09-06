import type { AuthorityCachedPreparation } from './browser-authority-client-contract';

export type VisibilityTask = Readonly<{
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  generatorVersion: number;
  visibilityBarrierRevision?: number;
}>;

export function matchesPreparedVisibilityCanonical(
  task: VisibilityTask,
  prepared: AuthorityCachedPreparation | undefined,
  canonical: Uint16Array,
) {
  const source =
    task.visibilityBarrierRevision !== undefined &&
    task.chunkRevision >= task.visibilityBarrierRevision &&
    prepared?.payload.key === task.chunkKey &&
    prepared.payload.cx === task.cx &&
    prepared.payload.cy === task.cy &&
    prepared.payload.cz === task.cz &&
    prepared.payload.chunkRevision === task.chunkRevision &&
    prepared.payload.generatorVersion === task.generatorVersion
      ? prepared.canonical
      : undefined;
  return Boolean(
    source && source.length === canonical.length && source.every((value, index) => value === canonical[index]),
  );
}
