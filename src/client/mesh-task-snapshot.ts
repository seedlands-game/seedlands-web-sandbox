export type MeshTaskIdentity = {
  taskId: number;
  epoch: number;
  chunkRevision: number;
  haloRevision: string;
};

export type MeshTaskSnapshot = MeshTaskIdentity & {
  chunkKey: string;
  canonical: Uint16Array;
  halo: Uint16Array;
};

export function createMeshTaskSnapshot(input: MeshTaskSnapshot): MeshTaskSnapshot {
  return { ...input, canonical: input.canonical.slice(), halo: input.halo.slice() };
}

export function isCurrentMeshTask(task: MeshTaskIdentity, current: MeshTaskIdentity): boolean {
  return (
    task.taskId === current.taskId &&
    task.epoch === current.epoch &&
    task.chunkRevision === current.chunkRevision &&
    task.haloRevision === current.haloRevision
  );
}
