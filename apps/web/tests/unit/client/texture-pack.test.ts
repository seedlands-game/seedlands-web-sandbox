import { describe, expect, it } from 'vitest';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import { builtinTerrainTextures, terrainMaterials } from '../../../src/client/presentation/terrain-assets';
import { compileTextureAtlas, validateTerrainTexture } from '../../../src/client/presentation/texture-pack';

describe('纹理源与编译合同', () => {
  it('覆盖全部逻辑方块面，源贴图为16像素，材质ID不依赖图集位置', () => {
    expect(terrainMaterials.map((m) => m.faceMaterial).sort((a, b) => a - b)).toEqual(Object.values(FaceMaterial));
    for (const material of terrainMaterials) {
      const source = builtinTerrainTextures.find((t) => t.id === material.textureId)!;
      expect(source.payload.width).toBe(16);
      expect(source.payload.height).toBe(16);
      expect(() => validateTerrainTexture(source, material.faceMaterial)).not.toThrow();
    }
  });
  it('输入重排后产物和索引不变，边缘扩展避免相邻采样串色', () => {
    const a = compileTextureAtlas(builtinTerrainTextures);
    const b = compileTextureAtlas([...builtinTerrainTextures].reverse());
    expect(a).toEqual(b);
    for (const entry of a.entries) {
      const corner = (entry.y * a.width + entry.x) * 4;
      const padding = ((entry.y - 1) * a.width + entry.x - 1) * 4;
      expect(a.pixels.slice(corner, corner + 4)).toEqual(a.pixels.slice(padding, padding + 4));
    }
  });
  it('拒绝重复ID与不合规尺寸/透明度，不隐式缩放', () => {
    const texture = structuredClone(builtinTerrainTextures[0]);
    expect(() => compileTextureAtlas([texture, texture])).toThrow();
    texture.payload.pixels[0] = 0;
    expect(() => validateTerrainTexture(texture, FaceMaterial.Dirt)).toThrow(/透明/);
    texture.payload.width = 32;
    expect(() => validateTerrainTexture(texture, FaceMaterial.Dirt)).toThrow();
  });
});
