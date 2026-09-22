import { describe, expect, it } from 'vitest';
import { FaceMaterial } from '@seedlands/stdlib/world/voxel';
import { builtinTerrainTextures, terrainMaterials } from '../../../src/client/presentation/terrain-assets';
import {
  voxelEmissionPixelCanEmit,
  voxelEmissionProfile,
  voxelEmissionThreshold,
} from '../../../src/app/scene/voxel-emission-profile';

const linear = (channel: number) => {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const textureFor = (face: FaceMaterial) => {
  const material = terrainMaterials.find((candidate) => candidate.faceMaterial === face)!;
  return builtinTerrainTextures.find((texture) => texture.id === material.textureId)!;
};

describe('体素表面发光阈值', () => {
  it('让热像素发光而保留火把木柄、炉体、矿石与南瓜结构', () => {
    expect(voxelEmissionThreshold(FaceMaterial.Lava)).toBe(0);
    expect(voxelEmissionThreshold(FaceMaterial.Fire)).toBe(0);
    expect(voxelEmissionThreshold(FaceMaterial.Torch)).toBeGreaterThan(0);
    expect(voxelEmissionThreshold(FaceMaterial.LitFurnace)).toBeGreaterThan(0);
    expect(voxelEmissionThreshold(FaceMaterial.LitRedstoneOre)).toBeGreaterThan(0);
    expect(voxelEmissionThreshold(FaceMaterial.JackOLantern)).toBeGreaterThan(0);
    expect(voxelEmissionThreshold(FaceMaterial.Stone)).toBe(1);
  });

  it('燃烧炉与发光红石矿只让亮色贴图像素跨过发光阈值', () => {
    for (const face of [FaceMaterial.LitFurnace, FaceMaterial.LitRedstoneOre]) {
      const texture = textureFor(face);
      const pixels = texture.payload.pixels.map(
        (index) => texture.payload.palette[index].map(linear) as [number, number, number],
      );
      expect(pixels.some((pixel) => voxelEmissionPixelCanEmit(face, pixel))).toBe(true);
      expect(pixels.some((pixel) => !voxelEmissionPixelCanEmit(face, pixel))).toBe(true);
    }
  });

  it('发光红石矿的灰色石底不满足红色优势条件', () => {
    const texture = textureFor(FaceMaterial.LitRedstoneOre);
    const profile = voxelEmissionProfile(FaceMaterial.LitRedstoneOre);
    const pixels = texture.payload.pixels.map(
      (index) => texture.payload.palette[index].map(linear) as [number, number, number],
    );
    const grayStone = pixels.filter(([red, green, blue]) => red - Math.max(green, blue) < profile.redDominance);
    expect(grayStone).not.toHaveLength(0);
    expect(grayStone.every((pixel) => !voxelEmissionPixelCanEmit(FaceMaterial.LitRedstoneOre, pixel))).toBe(true);
  });
});
