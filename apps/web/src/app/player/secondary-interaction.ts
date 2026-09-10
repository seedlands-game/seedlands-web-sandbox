import type { VoxelTarget } from '../../client/presentation/voxel-target';

export type SecondaryInteractionResult = 'target' | 'held-item' | 'place' | 'out-of-range' | 'blocked';

export function performSecondaryInteraction(
  input: Readonly<{
    target: VoxelTarget | null;
    bypassTarget: boolean;
    useTarget: (position: [number, number, number]) => boolean;
    useHeldItem: () => boolean;
    place: (position: [number, number, number]) => void;
    feedback: (message: string, tone: 'error') => void;
  }>,
): SecondaryInteractionResult {
  if (!input.bypassTarget && input.target && input.useTarget(input.target.position)) return 'target';
  if (input.useHeldItem()) return 'held-item';
  if (!input.target) {
    input.feedback('距离过远', 'error');
    return 'out-of-range';
  }
  if (!input.target.adjacent) {
    input.feedback('无法放置', 'error');
    return 'blocked';
  }
  input.place(input.target.adjacent);
  return 'place';
}
