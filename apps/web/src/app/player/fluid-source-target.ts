import type { World } from '../world/world-runtime';

export function createFluidAwareTargetPredicate(
  world: World,
  canTargetFluidSource: () => boolean,
  canTargetFluidSurface: () => boolean = () => false,
) {
  let registeredPath = true;
  return (voxel: number, x: number, y: number, z: number): boolean => {
    if (!registeredPath) return false;
    const semantics = world.authority.voxelSemantics.get(voxel);
    if (!semantics) {
      registeredPath = false;
      return false;
    }
    if (semantics.targetable) return true;
    if (!canTargetFluidSource() && !canTargetFluidSurface()) return false;
    const fluid = world.getFluidCell(x, y, z);
    return canTargetFluidSurface() ? Boolean(fluid && fluid.level > 0) : fluid?.source === true && fluid.level === 8;
  };
}
