import { FaceMaterial, faceMaterialNames, type FaceMaterialId } from '../../world/voxel';
import type { PixelTexture, Rgb } from './asset-types';

export type TerrainMaterial = {
  id: string;
  name: string;
  faceMaterial: FaceMaterialId;
  textureId: string;
  renderMode: 'opaque' | 'cutout' | 'transparent';
  emissiveIntensity: number;
};
const palette = (colors: string[]): Rgb[] => [
  [0, 0, 0],
  ...colors.map((hex) => [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb),
];
const sources: [FaceMaterialId, string, string[]][] = [
  [FaceMaterial.GrassTop, '草顶', ['537c3e', '639449', '789f50', '456b35']],
  [FaceMaterial.GrassSide, '草侧', ['795239', '996848', '65432f', '639449', '789f50']],
  [FaceMaterial.Dirt, '泥土', ['795239', '996848', '65432f', 'b17c50']],
  [FaceMaterial.Stone, '石头', ['737c7b', '8a9290', '5d6667', 'a0a59a']],
  [FaceMaterial.Sand, '沙砾', ['c6ac73', 'deca8e', 'b49663', 'e8d9a6']],
  [FaceMaterial.WoodSide, '树皮', ['745034', '956442', '593c2b', 'b27f4d']],
  [FaceMaterial.WoodEnd, '年轮', ['ad8151', 'c99b60', '855c38', 'dfb779']],
  [FaceMaterial.Leaves, '树叶', ['365d3c', '548449', '719454', '294d36']],
  [FaceMaterial.Snow, '积雪', ['d8e3df', 'eef3e8', 'b9cdc9', 'cadbd6']],
  [FaceMaterial.Water, '水面', ['286d86', '3b869a', '246078', '55a4af']],
  [FaceMaterial.Glowstone, '辉光石', ['aa703a', 'e2a752', '7d5433', 'f6d68a']],
  [FaceMaterial.LanternFrame, '灯笼框架', ['865b37', 'b88c4f', '583f2c', 'd1a76a']],
  [FaceMaterial.LanternGlow, '灯笼灯芯', ['d49c4d', 'ebbe68', 'ab7538', 'ffe4a1']],
];

// First-party pixel sources are deterministic and independent of atlas layout.
export const builtinTerrainTextures: PixelTexture[] = sources.map(([face, name, colors]) => {
  const pixels = Array.from({ length: 256 }, (_, i) => {
    const x = i % 16,
      y = Math.floor(i / 16);
    const noise = (x * 73 + y * 137 + x * y * 19 + face * 29) % 37;
    let index = noise < 6 ? 2 : noise > 31 ? 3 : noise === 20 ? 4 : 1;
    if (face === FaceMaterial.GrassSide) index = y < 3 + ((x * 7) % 3) ? (x % 3 === 0 ? 5 : 4) : Math.min(index, 3);
    if (face === FaceMaterial.WoodSide) index = x % 5 === 0 || (x + (y % 4)) % 11 === 0 ? 3 : x % 5 === 1 ? 2 : 1;
    if (face === FaceMaterial.WoodEnd) index = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) % 3 < 1 ? 3 : 2;
    if (face === FaceMaterial.Leaves && noise < 8) index = 0;
    if (face === FaceMaterial.Water) index = (y + Math.floor(x / 4)) % 7 === 0 ? 4 : noise < 10 ? 2 : 1;
    if (face === FaceMaterial.LanternFrame) index = x < 2 || x > 13 || y < 2 || y > 13 ? 3 : 2;
    if (face === FaceMaterial.LanternGlow) index = x > 3 && x < 12 && y > 2 && y < 13 ? 4 : 1;
    return index;
  });
  return {
    id: `seedlands:texture/terrain/${faceMaterialNames[face]}`,
    name: `${name}贴图`,
    source: 'builtin',
    type: 'pixel-texture',
    revision: 1,
    payload: { width: 16, height: 16, palette: palette(colors), pixels },
  };
});
export const terrainMaterials: TerrainMaterial[] = sources.map(([faceMaterial, name], i) => ({
  id: `seedlands:material/terrain/${faceMaterialNames[faceMaterial]}`,
  name,
  faceMaterial,
  textureId: builtinTerrainTextures[i].id,
  renderMode:
    faceMaterial === FaceMaterial.Leaves ? 'cutout' : faceMaterial === FaceMaterial.Water ? 'transparent' : 'opaque',
  emissiveIntensity:
    faceMaterial === FaceMaterial.Glowstone ? 1.15 : faceMaterial === FaceMaterial.LanternGlow ? 1.4 : 0,
}));
export const terrainMaterial = (id: number) => terrainMaterials.find((material) => material.faceMaterial === id);
