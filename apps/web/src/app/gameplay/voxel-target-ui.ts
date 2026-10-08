import { voxelNames } from '@seedlands/stdlib/world/voxel';
import type { VoxelTarget } from '../../client/presentation/voxel-target';
import type { InteractionTarget } from '../ui/ui-contracts';

export function projectVoxelInteractionTarget(target: VoxelTarget | null, blocked: boolean): InteractionTarget | null {
  return target?.inRange && !blocked
    ? { kind: 'voxel', id: target.position.join(','), label: voxelNames[target.voxel] ?? '体素', voxel: target.voxel }
    : null;
}
