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
  fluid?: Uint8Array;
  fluidHalo?: Uint8Array;
};

export function createMeshTaskSnapshot(input: MeshTaskSnapshot): MeshTaskSnapshot {
  const fluid = input.fluid ?? Uint8Array.from(input.canonical, (voxel) => (voxel === 8 ? 0x88 : 0));
  const fluidHalo = input.fluidHalo ?? Uint8Array.from(input.halo, (voxel) => (voxel === 8 ? 0x88 : 0));
  return {
    ...input,
    canonical: input.canonical.slice(),
    halo: input.halo.slice(),
    fluid: fluid.slice(),
    fluidHalo: fluidHalo.slice(),
  };
}

export function isCurrentMeshTask(task: MeshTaskIdentity, current: MeshTaskIdentity): boolean {
  return (
    task.taskId === current.taskId &&
    task.epoch === current.epoch &&
    task.chunkRevision === current.chunkRevision &&
    task.haloRevision === current.haloRevision
  );
}
