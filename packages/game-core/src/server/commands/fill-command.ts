import type { GameServer, WorldCommitResult } from '../game-server';
import { CHUNK_SIZE, floorDiv } from '../../world/voxel';
import { WorldMutationBuffer, assertMutationCoordinate, assertVoxelValue } from '../world-mutation';

export const MAX_FILL_VOXELS = 1_000_000;

export type FillCommand = {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  voxel: number;
};

export function resolveFillCommand(command: FillCommand): WorldMutationBuffer {
  command.from.forEach(assertMutationCoordinate);
  command.to.forEach(assertMutationCoordinate);
  assertVoxelValue(command.voxel);
  const min = command.from.map((value, index) => Math.min(value, command.to[index])) as [number, number, number];
  const max = command.from.map((value, index) => Math.max(value, command.to[index])) as [number, number, number];
  const lengths = min.map((value, index) => BigInt(max[index]) - BigInt(value) + 1n);
  const volume = lengths[0] * lengths[1] * lengths[2];
  if (volume > BigInt(MAX_FILL_VOXELS))
    throw new RangeError(`FillCommand exceeds the ${MAX_FILL_VOXELS.toLocaleString('en-US')} voxel limit.`);
  const buffer = WorldMutationBuffer.forUniqueCoordinates({
    sourceId: 'fill-command',
    priority: 0,
    initialCapacity: Number(volume),
  });
  for (let cy = floorDiv(min[1], CHUNK_SIZE); cy <= floorDiv(max[1], CHUNK_SIZE); cy += 1)
    for (let cz = floorDiv(min[2], CHUNK_SIZE); cz <= floorDiv(max[2], CHUNK_SIZE); cz += 1)
      for (let cx = floorDiv(min[0], CHUNK_SIZE); cx <= floorDiv(max[0], CHUNK_SIZE); cx += 1)
        for (let y = Math.max(min[1], cy * CHUNK_SIZE); y <= Math.min(max[1], (cy + 1) * CHUNK_SIZE - 1); y += 1)
          for (let z = Math.max(min[2], cz * CHUNK_SIZE); z <= Math.min(max[2], (cz + 1) * CHUNK_SIZE - 1); z += 1)
            for (let x = Math.max(min[0], cx * CHUNK_SIZE); x <= Math.min(max[0], (cx + 1) * CHUNK_SIZE - 1); x += 1)
              buffer.write(x, y, z, command.voxel);
  return buffer;
}

export function executeFillCommand(server: GameServer, actorId: string, command: FillCommand): WorldCommitResult {
  return server.editBatch({ actorId, buffers: [resolveFillCommand(command)] });
}
