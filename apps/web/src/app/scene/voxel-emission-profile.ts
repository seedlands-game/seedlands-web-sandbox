import { FaceMaterial, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';

export type VoxelEmissionProfile = Readonly<{
  threshold: number;
  redDominance: number;
}>;

/**
 * Thresholds use the linear texture luminance sampled by the shader. They keep
 * structural pixels visible while allowing only each block's hot pixels to
 * contribute self-emission.
 */
export function voxelEmissionProfile(material: FaceMaterialId): VoxelEmissionProfile {
  switch (material) {
    case FaceMaterial.Glowstone:
      return { threshold: 0.04, redDominance: 0 };
    case FaceMaterial.LanternGlow:
    case FaceMaterial.Lava:
    case FaceMaterial.Fire:
      return { threshold: 0, redDominance: 0 };
    case FaceMaterial.Torch:
    case FaceMaterial.JackOLantern:
      return { threshold: 0.28, redDominance: 0 };
    case FaceMaterial.LitFurnace:
      return { threshold: 0.18, redDominance: 0.16 };
    case FaceMaterial.LitRedstoneOre:
      return { threshold: 0.14, redDominance: 0.16 };
    default:
      return { threshold: 1, redDominance: 0 };
  }
}

export const voxelEmissionThreshold = (material: FaceMaterialId) => voxelEmissionProfile(material).threshold;

export const voxelEmissionRedDominance = (material: FaceMaterialId) => voxelEmissionProfile(material).redDominance;

/** Mirrors the shader's nonzero-emission boundary for texture-level regression tests. */
export function voxelEmissionPixelCanEmit(material: FaceMaterialId, color: readonly [number, number, number]): boolean {
  const [red, green, blue] = color;
  const profile = voxelEmissionProfile(material);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return (
    luminance >= profile.threshold &&
    (profile.redDominance === 0 || red - Math.max(green, blue) >= profile.redDominance)
  );
}
