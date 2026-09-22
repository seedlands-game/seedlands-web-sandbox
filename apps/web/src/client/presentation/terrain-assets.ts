import { FaceMaterial, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import { faceMaterialNames } from '@seedlands/stdlib/world/face-material-names';
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
  [FaceMaterial.Rail, '铁轨', ['42484a', '899194', 'bd8040', 'd5dcde']],
  [FaceMaterial.PoweredRail, '动力铁轨', ['5d301b', 'd49228', 'f2c84b', '8e1f16']],
  [FaceMaterial.DetectorRail, '探测铁轨', ['5f4328', 'b87832', 'd5b05a', '70321f']],
  [FaceMaterial.Bedrock, '基岩', ['232628', '353a3c', '151719', '4b5052']],
  [FaceMaterial.Gravel, '砂砾', ['716c67', '918a83', '514e4c', 'aaa39b']],
  [FaceMaterial.LapisOre, '青金石矿', ['616968', '818987', '2441a1', '5371da']],
  [FaceMaterial.Clay, '黏土', ['81909a', 'a5b0b7', '66747e', 'c2ccd1']],
  [FaceMaterial.Ice, '冰', ['7fb4ce', 'afd7e6', '558ca9', 'd9f0f5']],
  [FaceMaterial.SnowBlock, '雪块', ['dbe7e5', 'f4f8f4', 'bdcfcc', 'ffffff']],
  [FaceMaterial.LapisBlock, '青金石块', ['17349a', '2854ca', '0b1d65', '5e82df']],
  [FaceMaterial.Slab, '半砖', ['737c7b', '8a9290', '5d6667', 'a0a59a']],
  [FaceMaterial.WoodStairs, '木楼梯', ['aa794a', 'bf905e', '725033', 'd2a675']],
  [FaceMaterial.CobblestoneStairs, '圆石楼梯', ['65706d', '87928a', '424c4a', 'a8afa3']],
  [FaceMaterial.WoodenDoor, '木门', ['75461f', 'a36b32', '4e2e18', 'cf9954']],
  [FaceMaterial.Ladder, '梯子', ['805326', 'b78343', '553416', 'd2a568']],
  [FaceMaterial.Torch, '火把', ['8b5526', 'f59c32', 'ffd266', '5b351b']],
  [FaceMaterial.Bed, '床', ['9d2424', 'd94a42', 'eee5d0', '6c1b1b']],
  [FaceMaterial.Sign, '告示牌', ['98703e', 'c79858', '65431f', 'e0bd77']],
  [FaceMaterial.Fence, '栅栏', ['7d532a', 'ae7d42', '513317', 'd0a061']],
  [FaceMaterial.Cake, '蛋糕', ['d4b58c', 'f3e2c3', '9b5f42', 'ffffff']],
  [FaceMaterial.DeadBush, '枯灌木', ['5b3a20', '80562d', '3b2618', 'a47942']],
  [FaceMaterial.Wool, '羊毛', ['c9c9c3', 'eeeeea', '9e9e99', 'ffffff']],
  [FaceMaterial.RedFlower, '红花', ['9e1722', 'e43d48', 'f18a45', '39722f']],
  [FaceMaterial.RedMushroom, '红蘑菇', ['8d1515', 'd32f2f', 'f4e2c0', '553325']],
  [FaceMaterial.Bricks, '砖块', ['7e3226', 'a94c38', 'd8896b', '3e2520']],
  [FaceMaterial.Bookshelf, '书架', ['734824', 'a7783f', '3f2b1c', '315784']],
  [FaceMaterial.MossyCobblestone, '苔石', ['59615a', '788172', '344f35', '93a288']],
  [FaceMaterial.NoteBlock, '音符盒', ['5c341d', '8d562b', '2c1d14', 'bf7d3d']],
  [FaceMaterial.Jukebox, '唱片机', ['462617', '70401f', '17191b', 'a36732']],
  [FaceMaterial.Pumpkin, '南瓜', ['a8460d', 'e36e15', '70300b', 'f59a2c']],
  [FaceMaterial.JackOLantern, '南瓜灯', ['bd5008', 'ff8b13', '57300c', 'ffd05a']],
  [FaceMaterial.Trapdoor, '活板门', ['6f431f', '9e6732', '432915', 'c59050']],
  [FaceMaterial.LitFurnace, '燃烧熔炉', ['5a6263', '838b88', 'd95b1d', 'ffbc48']],
  [FaceMaterial.RedstoneOre, '红石矿', ['687170', '858d8a', '8d1d25', 'd74343']],
  [FaceMaterial.LitRedstoneOre, '发光红石矿', ['687170', '858d8a', 'd51c27', 'ff746d']],
];
const plantMaterials = new Set<number>([
  FaceMaterial.Sapling,
  FaceMaterial.TallGrass,
  FaceMaterial.Flower,
  FaceMaterial.Mushroom,
  FaceMaterial.SugarCane,
]);

/**
 * Plants are cutout cards. Keep their zero pixels as a deliberate silhouette:
 * the mesher owns the crossed-card geometry, while this source owns only its
 * readable 16px outline. They must not degrade into a full tile with holes.
 */
function plantPixel(face: FaceMaterialId, x: number, y: number): number {
  const stem = (color = 1) => ((x === 7 || x === 8) && y >= 7 ? color : 0);
  if (face === FaceMaterial.TallGrass)
    return (x >= 6 && x <= 9 && y >= 7) || (x === 5 && y >= 10) || (x === 10 && y >= 8)
      ? (x + y) % 5 === 0
        ? 3
        : 1
      : 0;
  if (face === FaceMaterial.Sapling)
    return stem(2) || (y >= 4 && y <= 10 && Math.abs(x - 7.5) <= 5 - Math.abs(y - 7)) ? ((x + y) % 4 === 0 ? 3 : 1) : 0;
  if (face === FaceMaterial.SugarCane)
    return (x >= 5 && x <= 7) || (x >= 9 && x <= 11) || (x >= 7 && x <= 9 && y >= 3) ? (x % 3 === 0 ? 3 : 1) : 0;
  if (face === FaceMaterial.DeadBush)
    return (y >= 10 && x >= 7 && x <= 8) || (y >= 7 && y <= 12 && (x === y - 2 || x === 17 - y || x === 6 || x === 9))
      ? (x + y) % 4 === 0
        ? 4
        : 1
      : 0;
  const red = face === FaceMaterial.Flower || face === FaceMaterial.RedFlower;
  if (red) {
    if (stem(4) || ((x === 5 || x === 10) && y >= 11)) return 4;
    const petal = y >= 3 && y <= 10 && Math.abs(x - 7.5) <= (y < 7 ? 3 : 5);
    return petal ? ((x + y) % 5 === 0 ? 3 : y >= 6 && x >= 7 && x <= 8 ? 2 : 1) : 0;
  }
  const redCap = face === FaceMaterial.RedMushroom;
  if (y >= 10 && y <= 15 && x >= 7 && x <= 8) return 3;
  const cap = y >= 3 && y <= 11 && Math.abs(x - 7.5) <= 6 - Math.max(0, 6 - y);
  if (!cap) return 0;
  if (redCap && ((x === 6 && y === 7) || (x === 9 && y === 5) || (x === 8 && y === 9))) return 3;
  return (x + y) % 5 === 0 ? 3 : 1;
}

function structuralBase(face: FaceMaterialId, x: number, y: number): number {
  const grain = (x * 17 + y * 31 + face * 7 + x * y) % 13;
  if (
    (
      [FaceMaterial.Dirt, FaceMaterial.GrassTop, FaceMaterial.Sand, FaceMaterial.Gravel, FaceMaterial.Clay] as number[]
    ).includes(face)
  )
    return grain < 2 ? 3 : grain > 10 ? 2 : 1;
  if (
    (
      [FaceMaterial.Stone, FaceMaterial.Slab, FaceMaterial.CobblestoneStairs, FaceMaterial.Bedrock] as number[]
    ).includes(face)
  )
    return (x + y * 2) % 7 === 0 ? 3 : grain < 3 ? 2 : 1;
  if (([FaceMaterial.Snow, FaceMaterial.SnowBlock, FaceMaterial.Ice] as number[]).includes(face))
    return (x * 3 + y) % 11 === 0 ? 3 : grain < 4 ? 2 : 1;
  if (
    (
      [FaceMaterial.Obsidian, FaceMaterial.LapisBlock, FaceMaterial.NoteBlock, FaceMaterial.Jukebox] as number[]
    ).includes(face)
  )
    return (x + y) % 9 === 0 ? 3 : grain < 3 ? 2 : 1;
  return grain < 3 ? 2 : grain > 10 ? 3 : 1;
}

// First-party pixel sources are deterministic and independent of atlas layout.
export const builtinTerrainTextures: PixelTexture[] = sources.map(([face, name, colors]) => {
  const pixels = Array.from({ length: 256 }, (_, i) => {
    const x = i % 16,
      y = Math.floor(i / 16);
    const noise = (x * 73 + y * 137 + x * y * 19 + face * 29) % 37;
    let index = structuralBase(face, x, y);
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
    if (plantMaterials.has(face)) index = plantPixel(face, x, y);
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
    if ([FaceMaterial.Rail, FaceMaterial.PoweredRail, FaceMaterial.DetectorRail].includes(face as 42 | 43 | 44)) {
      index = x < 3 || x > 12 ? 2 : x === 7 || x === 8 ? 3 : 0;
      if (face !== FaceMaterial.Rail && y % 5 === 0 && x > 3 && x < 12) index = 4;
    }
    if ([FaceMaterial.DeadBush, FaceMaterial.RedFlower, FaceMaterial.RedMushroom].includes(face as 62 | 64 | 65))
      index = plantPixel(face, x, y);
    if (face === FaceMaterial.Bricks) {
      const row = Math.floor(y / 4);
      index = y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0 ? 3 : y % 4 === 1 ? 4 : 1;
    }
    if (face === FaceMaterial.Bookshelf) {
      index = y === 1 || y === 14 || x === 1 || x === 14 ? 3 : y === 7 || y === 8 ? 2 : (x + y * 3) % 5 === 0 ? 4 : 1;
    }
    if (face === FaceMaterial.Pumpkin || face === FaceMaterial.JackOLantern) {
      index = x < 2 || x > 13 ? 3 : x % 4 === 0 ? 2 : 1;
      if (
        face === FaceMaterial.JackOLantern &&
        y >= 5 &&
        y <= 11 &&
        (x === 4 || x === 11 || (y >= 9 && x >= 6 && x <= 9))
      )
        index = 4;
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
    faceMaterial === FaceMaterial.Leaves ||
    faceMaterial === FaceMaterial.Glass ||
    [
      FaceMaterial.Sapling,
      FaceMaterial.TallGrass,
      FaceMaterial.Flower,
      FaceMaterial.Mushroom,
      FaceMaterial.SugarCane,
      FaceMaterial.DeadBush,
      FaceMaterial.RedFlower,
      FaceMaterial.RedMushroom,
      FaceMaterial.Fire,
      FaceMaterial.Rail,
      FaceMaterial.PoweredRail,
      FaceMaterial.DetectorRail,
    ].includes(faceMaterial as 32 | 34 | 35 | 36 | 37 | 38 | 42 | 43 | 44 | 62 | 64 | 65)
      ? 'cutout'
      : faceMaterial === FaceMaterial.Water || faceMaterial === FaceMaterial.Ice
        ? 'transparent'
        : 'opaque',
  emissiveIntensity:
    faceMaterial === FaceMaterial.Glowstone
      ? 1.15
      : faceMaterial === FaceMaterial.LanternGlow
        ? 1.4
        : [
              FaceMaterial.Lava,
              FaceMaterial.Fire,
              FaceMaterial.Torch,
              FaceMaterial.JackOLantern,
              FaceMaterial.LitFurnace,
              FaceMaterial.LitRedstoneOre,
            ].includes(faceMaterial as 30 | 32 | 57 | 72 | 74 | 76)
          ? 1.05
          : 0,
}));
export const terrainMaterial = (id: number) => terrainMaterials.find((material) => material.faceMaterial === id);
