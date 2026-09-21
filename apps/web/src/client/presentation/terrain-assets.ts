import { FaceMaterial, faceMaterialNames, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';
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
  [FaceMaterial.Workbench, '工作台', ['986239', 'bd884d', '68442f', 'e1b76d']],
  [FaceMaterial.Chest, '箱子', ['986239', 'bd884d', '68442f', 'ebc774', '35474b', 'c18b41']],
  [FaceMaterial.Furnace, '熔炉', ['617477', '93a4a0', '35474b', 'd3863e', '242f32', 'ebc774']],
  [FaceMaterial.CoalOre, '煤矿石', ['687170', '858d8a', '252a2b', 'a0a59a']],
  [FaceMaterial.IronOre, '铁矿石', ['747b78', '949b96', '9c694d', 'c28b68']],
  [FaceMaterial.Planks, '木板', ['aa794a', 'bf905e', '725033', 'd2a675']],
  [FaceMaterial.Cobblestone, '圆石', ['65706d', '87928a', '424c4a', 'a8afa3']],
  [FaceMaterial.Glass, '玻璃', ['accbd0', 'd4edf0', '8aafb8', 'edfafa']],
  [FaceMaterial.GoldOre, '金矿石', ['687170', '858d8a', 'bf9330', 'f3d677']],
  [FaceMaterial.DiamondOre, '钻石矿石', ['687170', '858d8a', '399da5', '9ce6db']],
  [FaceMaterial.IronBlock, '铁块', ['a5b3b1', 'c7d5d0', '728a89', 'e3e9dc']],
  [FaceMaterial.GoldBlock, '金块', ['c89e3f', 'e5c65f', '99702c', 'ffe59c']],
  [FaceMaterial.DiamondBlock, '钻石块', ['39a4ab', '6fced0', '20747e', 'b7efe6']],
  [FaceMaterial.Sandstone, '砂岩', ['c9b988', 'ddd0a0', 'a89966', 'efe6c2']],
  [FaceMaterial.StoneBricks, '石砖', ['6b7074', '858c90', '4c5155', 'a3aab0']],
  [FaceMaterial.Farmland, '耕地', ['4d3722', '5c4026', '3a2917', '6f4f2e']],
  [FaceMaterial.Lava, '熔岩', ['c43d12', 'f06b18', '8e2510', 'ffb12e']],
  [FaceMaterial.Obsidian, '黑曜石', ['171121', '292039', '0b0810', '49305c']],
  [FaceMaterial.Fire, '火焰', ['9e250b', 'e94b12', 'ff8b1a', 'ffd34e']],
  [FaceMaterial.Tnt, 'TNT', ['9c1717', 'd22b22', 'eee1c0', '292929']],
  [FaceMaterial.Sapling, '树苗', ['255c28', '3e8140', '6eaa4c', '9b6d3b']],
  [FaceMaterial.TallGrass, '高草', ['2d672d', '4c8d3b', '76aa51', '1f5025']],
  [FaceMaterial.Flower, '花', ['c32935', 'f05a65', 'f1d35c', '3e7b34']],
  [FaceMaterial.Mushroom, '蘑菇', ['7e302a', 'b94f3f', 'e2d2ad', '594032']],
  [FaceMaterial.SugarCane, '甘蔗', ['477d39', '71a950', 'a0cc6d', '335f31']],
  [FaceMaterial.Cactus, '仙人掌', ['286a38', '3e8a49', '6aac59', '174e2c']],
  [FaceMaterial.Spawner, '刷怪笼', ['202629', '384348', '0d1113', '5b676c', '7b2c36']],
  [FaceMaterial.DungeonChest, '地牢战利品箱', ['61401f', '93612c', '302214', 'd29a45', 'b7c3c5']],
];
const plantMaterials = new Set<number>([
  FaceMaterial.Sapling,
  FaceMaterial.TallGrass,
  FaceMaterial.Flower,
  FaceMaterial.Mushroom,
  FaceMaterial.SugarCane,
]);

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
    if (face === FaceMaterial.Planks) {
      const row = Math.floor(y / 4);
      index = y % 4 === 0 || (x + row * 7) % 16 === 0 ? 3 : y % 4 === 1 ? 4 : noise < 8 ? 2 : 1;
    }
    if (face === FaceMaterial.Cobblestone) {
      const row = Math.floor(y / 5);
      index = y % 5 === 0 || (x + row * 3) % 7 === 0 ? 3 : y % 5 === 1 ? 4 : noise < 12 ? 2 : 1;
    }
    if (face === FaceMaterial.Glass) {
      index =
        x === 0 || y === 0 || x === 15 || y === 15 ? 1 : (x + y === 10 || x + y === 13) && x > 2 && x < 11 ? 2 : 0;
    }
    if (face === FaceMaterial.Leaves && noise < 8) index = 0;
    if (face === FaceMaterial.Water) index = (y + Math.floor(x / 4)) % 7 === 0 ? 4 : noise < 10 ? 2 : 1;
    if (face === FaceMaterial.Lava) index = (y + Math.floor(x / 3)) % 5 === 0 ? 4 : noise < 12 ? 2 : 1;
    if (face === FaceMaterial.Fire) index = y > 13 - Math.abs(x - 8) ? 0 : noise < 12 ? 4 : 2;
    if (plantMaterials.has(face)) index = (x + y + noise) % 4 === 0 ? 0 : noise < 12 ? 2 : 1;
    if (face === FaceMaterial.LanternFrame) index = x < 2 || x > 13 || y < 2 || y > 13 ? 3 : 2;
    if (face === FaceMaterial.LanternGlow) index = x > 3 && x < 12 && y > 2 && y < 13 ? 4 : 1;
    if (face === FaceMaterial.Workbench) {
      // Inlaid cutting grid over directional timber; a readable edge rather than random checks.
      index = y % 5 === 0 ? 3 : (x + y * 3) % 13 === 0 ? 2 : 1;
      if (x === 0 || x === 15 || y === 0 || y === 15) index = 3;
      if (x === 1 || y === 1) index = 4;
      if (x >= 3 && x <= 12 && y >= 3 && y <= 12) index = x % 4 === 0 || y % 4 === 0 ? 3 : 2;
      if ((x === 2 || x === 13) && (y === 2 || y === 13)) index = 4;
    }
    if (face === FaceMaterial.Chest) {
      index = y % 4 === 0 ? 3 : (x * 3 + y) % 17 < 2 ? 2 : 1;
      if (x === 1 || x === 14) index = 5;
      if (y === 1 || y === 14) index = 3;
      if (y === 6) index = 3;
      if (y === 5) index = 2;
      if ((x === 1 || x === 14) && (y === 2 || y === 13)) index = 6;
      if (x >= 6 && x <= 9 && y >= 5 && y <= 9) index = x === 6 || y === 9 ? 6 : 4;
      if (x === 8 && (y === 7 || y === 8)) index = 5;
    }
    if (face === FaceMaterial.Furnace) {
      const seam = y % 5 === 0 || (x + (Math.floor(y / 5) % 2) * 4) % 8 === 0;
      index = seam ? 3 : y % 5 === 1 ? 2 : 1;
      if (x >= 3 && x <= 12 && y >= 5 && y <= 12) index = 3;
      if (x >= 4 && x <= 11 && y >= 6 && y <= 11) index = 5;
      if (x >= 5 && x <= 10 && y === 11) index = x % 3 === 0 ? 6 : 4;
      if ((x === 6 || x === 9) && y === 10) index = 4;
    }
    if (
      [FaceMaterial.CoalOre, FaceMaterial.IronOre, FaceMaterial.GoldOre, FaceMaterial.DiamondOre].includes(
        face as 17 | 18 | 22 | 23,
      )
    ) {
      const clusters = [
        [4, 4],
        [11, 6],
        [7, 12],
      ];
      const ore = clusters.some(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) < 3);
      index = ore ? (face !== FaceMaterial.CoalOre && (x + y) % 3 === 0 ? 4 : 3) : noise < 7 ? 2 : 1;
    }
    if ([FaceMaterial.IronBlock, FaceMaterial.GoldBlock, FaceMaterial.DiamondBlock].includes(face as 24 | 25 | 26)) {
      index = x === 0 || y === 15 ? 3 : x === 15 || y === 0 ? 4 : (x + y) % 13 === 0 ? 2 : 1;
    }
    if (face === FaceMaterial.Sandstone) {
      // Layered sandstone: banded strata with a framed top and base course.
      index = y < 2 || y > 13 ? 3 : (y - 2) % 4 === 0 ? 2 : noise < 5 ? 4 : 1;
      if (x === 0 || x === 15) index = 3;
    }
    if (face === FaceMaterial.StoneBricks) {
      // Offset brick courses with recessed mortar seams.
      const row = Math.floor(y / 4);
      const seam = y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0;
      index = seam ? 3 : y % 4 === 1 ? 4 : noise < 9 ? 2 : 1;
    }
    if (face === FaceMaterial.Farmland) {
      // Tilled soil: furrowed rows with a moist top rim.
      index = y < 2 ? 4 : y % 4 === 0 ? 3 : noise < 8 ? 2 : 1;
    }
    if (face === FaceMaterial.Spawner) {
      const frame = x < 2 || x > 13 || y < 2 || y > 13 || x % 5 === 0 || y % 5 === 0;
      index = frame ? (noise < 12 ? 2 : 1) : (x + y) % 7 === 0 ? 5 : 3;
    }
    if (face === FaceMaterial.DungeonChest) {
      index = y === 6 || x === 1 || x === 14 ? 3 : noise < 8 ? 2 : 1;
      if (x >= 6 && x <= 9 && y >= 5 && y <= 9) index = x === 6 || y === 9 ? 5 : 4;
    }
    return index;
  });
  return {
    id: `seedlands:texture/terrain/${faceMaterialNames[face]}`,
    name: `${name}贴图`,
    source: 'builtin',
    type: 'pixel-texture',
    revision: face >= FaceMaterial.Workbench ? 2 : 1,
    payload: { width: 16, height: 16, palette: palette(colors), pixels },
  };
});
export const terrainMaterials: TerrainMaterial[] = sources.map(([faceMaterial, name], i) => ({
  id: `seedlands:material/terrain/${faceMaterialNames[faceMaterial]}`,
  name,
  faceMaterial,
  textureId: builtinTerrainTextures[i].id,
  renderMode:
    faceMaterial === FaceMaterial.Leaves || faceMaterial === FaceMaterial.Glass
      ? 'cutout'
      : faceMaterial === FaceMaterial.Water
        ? 'transparent'
        : 'opaque',
  emissiveIntensity:
    faceMaterial === FaceMaterial.Glowstone ? 1.15 : faceMaterial === FaceMaterial.LanternGlow ? 1.4 : 0,
}));
export const terrainMaterial = (id: number) => terrainMaterials.find((material) => material.faceMaterial === id);
