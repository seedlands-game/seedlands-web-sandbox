import type { PixelTexture, Rgb } from './asset-types';

export type ModelMaterialDefinition = Readonly<{
  id: string;
  name: string;
  textureId: string;
  roughness: number;
  metalness: number;
  emissive: Rgb;
  emissiveIntensity: number;
  palette: readonly [Rgb, Rgb, Rgb];
}>;

export const modelMaterialDefinitions = [
  {
    id: 'dirt',
    name: '泥土',
    textureId: 'seedlands:texture/model/dirt',
    roughness: 0.92,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [112, 70, 45],
      [157, 103, 64],
      [79, 47, 33],
    ],
  },
  {
    id: 'stone',
    name: '岩石',
    textureId: 'seedlands:texture/model/stone',
    roughness: 0.88,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [96, 107, 106],
      [146, 156, 149],
      [61, 71, 74],
    ],
  },
  {
    id: 'wood',
    name: '木材',
    textureId: 'seedlands:texture/model/wood',
    roughness: 0.92,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [110, 61, 32],
      [179, 114, 57],
      [63, 33, 22],
    ],
  },
  {
    id: 'wood-end',
    name: '木材截面',
    textureId: 'seedlands:texture/model/wood-end',
    roughness: 0.92,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [169, 102, 50],
      [226, 164, 88],
      [98, 55, 25],
    ],
  },
  {
    id: 'sand',
    name: '沙土',
    textureId: 'seedlands:texture/model/sand',
    roughness: 0.95,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [198, 163, 93],
      [227, 201, 120],
      [151, 115, 63],
    ],
  },
  {
    id: 'leaf',
    name: '叶片',
    textureId: 'seedlands:texture/model/leaf',
    roughness: 0.9,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [45, 107, 72],
      [95, 156, 86],
      [24, 61, 50],
    ],
  },
  {
    id: 'brass',
    name: '黄铜',
    textureId: 'seedlands:texture/model/brass',
    roughness: 0.5,
    metalness: 0.35,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [139, 89, 41],
      [208, 154, 68],
      [85, 52, 31],
    ],
  },
  {
    id: 'glow',
    name: '暖光石',
    textureId: 'seedlands:texture/model/glow',
    roughness: 0.8,
    metalness: 0,
    emissive: [1, 0.46, 0.1],
    emissiveIntensity: 0.55,
    palette: [
      [247, 214, 108],
      [255, 246, 189],
      [189, 96, 36],
    ],
  },
  {
    id: 'berry',
    name: '浆果',
    textureId: 'seedlands:texture/model/berry',
    roughness: 0.82,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [108, 38, 70],
      [189, 77, 105],
      [60, 25, 50],
    ],
  },
  {
    id: 'cream',
    name: '浅绒',
    textureId: 'seedlands:texture/model/cream',
    roughness: 0.94,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [214, 189, 120],
      [255, 240, 180],
      [143, 113, 68],
    ],
  },
  {
    id: 'umber',
    name: '棕褐',
    textureId: 'seedlands:texture/model/umber',
    roughness: 0.92,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [106, 64, 43],
      [128, 80, 56],
      [77, 48, 47],
    ],
  },
  {
    id: 'fur',
    name: '毛皮',
    textureId: 'seedlands:texture/model/fur',
    roughness: 0.95,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [141, 118, 83],
      [166, 139, 98],
      [108, 88, 63],
    ],
  },
  {
    id: 'charcoal',
    name: '炭黑',
    textureId: 'seedlands:texture/model/charcoal',
    roughness: 0.86,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [29, 50, 53],
      [42, 63, 65],
      [23, 41, 44],
    ],
  },
  {
    id: 'teal',
    name: '蓝绿',
    textureId: 'seedlands:texture/model/teal',
    roughness: 0.84,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [28, 111, 120],
      [67, 161, 160],
      [17, 62, 74],
    ],
  },
  {
    id: 'skin',
    name: '肤色',
    textureId: 'seedlands:texture/model/skin',
    roughness: 0.9,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [179, 109, 75],
      [224, 161, 106],
      [112, 66, 47],
    ],
  },
  {
    id: 'cloth',
    name: '布料',
    textureId: 'seedlands:texture/model/cloth',
    roughness: 0.94,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [28, 88, 94],
      [45, 109, 110],
      [22, 71, 77],
    ],
  },
  {
    id: 'boot',
    name: '靴子',
    textureId: 'seedlands:texture/model/boot',
    roughness: 0.86,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [37, 42, 48],
      [52, 58, 64],
      [29, 34, 40],
    ],
  },
  {
    id: 'eye',
    name: '眼睛',
    textureId: 'seedlands:texture/model/eye',
    roughness: 0.7,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [21, 24, 35],
      [246, 240, 210],
      [9, 11, 17],
    ],
  },
  {
    id: 'glow-eye',
    name: '发光眼',
    textureId: 'seedlands:texture/model/glow-eye',
    roughness: 0.72,
    metalness: 0,
    emissive: [1, 0.46, 0.1],
    emissiveIntensity: 1.5,
    palette: [
      [255, 188, 74],
      [255, 214, 120],
      [210, 136, 52],
    ],
  },
  {
    id: 'hurt',
    name: '受伤闪烁',
    textureId: 'seedlands:texture/model/hurt',
    roughness: 0.84,
    metalness: 0,
    emissive: [0, 0, 0],
    emissiveIntensity: 0,
    palette: [
      [138, 31, 27],
      [240, 101, 66],
      [77, 17, 20],
    ],
  },
] as const satisfies readonly ModelMaterialDefinition[];

export type ModelMaterialId = (typeof modelMaterialDefinitions)[number]['id'];

function texturePixels(definition: ModelMaterialDefinition): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 16; x += 1) {
      if (definition.id === 'skin' || definition.id === 'eye' || definition.id === 'glow-eye') {
        pixels.push(1);
        continue;
      }
      if (definition.id === 'cloth') {
        pixels.push(y === 3 || y === 12 ? 2 : (x === 2 || x === 13) && y % 4 === 0 ? 3 : 1);
        continue;
      }
      if (definition.id === 'boot' || definition.id === 'charcoal') {
        pixels.push(y === 4 || y === 11 ? 2 : 1);
        continue;
      }
      const pick = (x * 7 + y * 11 + x * y) % (definition.id === 'fur' ? 11 : 5);
      let color = pick === 0 ? 2 : pick === 1 ? 3 : 1;
      if (definition.id === 'wood' && [3, 8, 13].includes(x)) color = 3;
      pixels.push(color);
    }
  return pixels;
}

export const builtinModelTextures: PixelTexture[] = modelMaterialDefinitions.map((definition) => ({
  id: definition.textureId,
  name: `${definition.name} 16px`,
  revision: 1,
  source: 'builtin',
  type: 'pixel-texture',
  payload: {
    width: 16,
    height: 16,
    palette: [[0, 0, 0], ...definition.palette.map((color) => [...color] as Rgb)],
    pixels: texturePixels(definition),
  },
}));
