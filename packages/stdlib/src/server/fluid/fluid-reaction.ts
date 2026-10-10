import { Voxel } from '../../world/voxel';
import type { FluidCellValue, FluidPosition } from './fluid-transaction';

export type FluidReaction = Readonly<{ position: FluidPosition; voxel: number; fluid: 0 }>;
export const fluidReaction = (
  position: FluidPosition,
  left: FluidCellValue,
  right: FluidCellValue,
): FluidReaction | null => {
  const pair = new Set([left.voxel, right.voxel]);
  if (!pair.has(Voxel.Water) || !pair.has(Voxel.Lava)) return null;
  const lava = left.voxel === Voxel.Lava ? left : right;
  const reaction: FluidReaction = {
    position: [position[0], position[1], position[2]],
    voxel: (lava.fluid & 0x80) !== 0 ? Voxel.Obsidian : Voxel.Cobblestone,
    fluid: 0,
  };
  return Object.freeze(reaction);
};
