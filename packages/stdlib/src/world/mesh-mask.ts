import type { FaceMaterialId } from './voxel';

export type MeshMaskCell = {
  material: FaceMaterialId;
  renderCategory: 'opaque' | 'cutout' | 'emissive' | 'transparent';
  back: boolean;
  ao: readonly [number, number, number, number];
  fluidLevel: number;
  fluidFloorHeight: number;
};

export const sameMeshMaskCell = (left: MeshMaskCell | null | undefined, right: MeshMaskCell) =>
  left?.material === right.material &&
  left.renderCategory === right.renderCategory &&
  left.back === right.back &&
  left.ao.every((value, index) => value === right.ao[index]) &&
  left.fluidLevel === right.fluidLevel &&
  left.fluidFloorHeight === right.fluidFloorHeight;
