import * as pc from 'playcanvas';
import { publicAssetUrl } from '../client/public-asset-url';
import { FaceMaterial, faceMaterialNames, type FaceMaterialId } from '../world/voxel';
import type { MeshPart } from './app-contracts';
import type { QualityProfile } from './quality-profile';
import { MATERIAL_LAYER_COUNT, type RenderCategory } from './voxel-render-pipeline';
import {
  voxelArrayDiffuseGlsl,
  voxelArrayDiffuseWgsl,
  voxelArrayOpacityGlsl,
  voxelArrayOpacityWgsl,
} from './shaders/voxel-array-chunks';

const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

function loadAtlas(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Voxel texture atlas could not be loaded.'));
    image.src = publicAssetUrl(import.meta.env.BASE_URL, 'assets/voxel-atlas.webp');
  });
}

function drawMirroredTile(image: HTMLImageElement, column: number, row: number, leaves: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const sourceSize = image.naturalWidth / 3;
  for (let y = 0; y < 2; y += 1)
    for (let x = 0; x < 2; x += 1) {
      context.save();
      context.translate(x * 64 + (x ? 64 : 0), y * 64 + (y ? 64 : 0));
      context.scale(x ? -1 : 1, y ? -1 : 1);
      context.drawImage(image, column * sourceSize, row * sourceSize, sourceSize, sourceSize, 0, 0, 64, 64);
      context.restore();
    }
  if (leaves) {
    const pixels = context.getImageData(0, 0, 128, 128);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const brightness = (pixels.data[index] + pixels.data[index + 1] * 1.5 + pixels.data[index + 2]) / 3.5;
      pixels.data[index + 3] = brightness < 35 ? 0 : Math.min(255, Math.round((brightness - 35) * 10));
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function waterCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 128, 128);
  gradient.addColorStop(0, '#2d9ab2');
  gradient.addColorStop(0.5, '#176f96');
  gradient.addColorStop(1, '#2d9ab2');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  context.globalAlpha = 0.25;
  context.strokeStyle = '#b9f2e8';
  context.lineWidth = 2;
  for (let band = -1; band <= 4; band += 1) {
    context.beginPath();
    for (let x = 0; x <= 128; x += 4) {
      const y = band * 36 + Math.sin((x / 128) * Math.PI * 4) * 6;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  return canvas;
}

function textureFromCanvas(device: pc.GraphicsDevice, name: string, canvas: HTMLCanvasElement) {
  const texture = new pc.Texture(device, {
    name,
    width: canvas.width,
    height: canvas.height,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: 4,
    srgb: true,
  });
  texture.setSource(canvas);
  return texture;
}

export type VoxelMaterials = {
  categoryMaterials: Map<RenderCategory, pc.StandardMaterial>;
  resolve: (part: MeshPart) => pc.StandardMaterial;
  water: readonly pc.StandardMaterial[];
  destroy: () => void;
};

export async function createVoxelMaterials(app: pc.Application, quality: QualityProfile): Promise<VoxelMaterials> {
  const image = await loadAtlas();
  const tiles = new Map<FaceMaterialId, pc.Texture>();
  const tileCanvases = new Map<FaceMaterialId, HTMLCanvasElement>();
  const atlasPositions: Record<number, readonly [number, number]> = {
    [FaceMaterial.GrassTop]: [0, 0],
    [FaceMaterial.GrassSide]: [1, 0],
    [FaceMaterial.Dirt]: [2, 0],
    [FaceMaterial.Stone]: [0, 1],
    [FaceMaterial.Sand]: [1, 1],
    [FaceMaterial.WoodSide]: [2, 1],
    [FaceMaterial.WoodEnd]: [0, 2],
    [FaceMaterial.Leaves]: [1, 2],
    [FaceMaterial.Snow]: [2, 2],
  };
  for (const [rawMaterial, [column, row]] of Object.entries(atlasPositions)) {
    const material = Number(rawMaterial) as FaceMaterialId;
    const canvas = drawMirroredTile(image, column, row, material === FaceMaterial.Leaves);
    tileCanvases.set(material, canvas);
    if (material === FaceMaterial.Stone || material === FaceMaterial.Leaves)
      tiles.set(material, textureFromCanvas(app.graphicsDevice, faceMaterialNames[material], canvas));
  }
  const water = waterCanvas();
  tileCanvases.set(FaceMaterial.Water, water);
  tiles.set(FaceMaterial.Water, textureFromCanvas(app.graphicsDevice, 'water', water));

  const arrayLayers = Array.from({ length: MATERIAL_LAYER_COUNT }, (_unused, layer) => {
    const canvas = tileCanvases.get((layer + 1) as FaceMaterialId);
    if (!canvas) throw new Error(`Missing voxel texture array layer ${layer}.`);
    return canvas;
  });
  const textureArray = new pc.Texture(app.graphicsDevice, {
    name: 'voxel-material-array',
    width: 128,
    height: 128,
    arrayLength: MATERIAL_LAYER_COUNT,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: 4,
    srgb: true,
    // PlayCanvas stores array layers under mip level zero. setSource() accepts a
    // single browser source and would invalidate an array texture.
    levels: [arrayLayers] as unknown as HTMLCanvasElement[],
  });

  const createCategoryMaterial = (category: RenderCategory) => {
    const sampleId =
      category === 'cutout'
        ? FaceMaterial.Leaves
        : category === 'transparent'
          ? FaceMaterial.Water
          : FaceMaterial.Stone;
    const material = new pc.StandardMaterial();
    material.name = `voxel-${category}`;
    material.diffuse = category === 'transparent' ? new pc.Color(0.52, 0.88, 0.94) : pc.Color.WHITE;
    material.ambient = pc.Color.WHITE;
    material.diffuseMap = tiles.get(sampleId)!;
    material.diffuseVertexColor = true;
    material.gloss = category === 'transparent' ? 0.82 : 0.08;
    material.shaderChunksVersion = '2.8';
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('diffusePS', voxelArrayDiffuseGlsl);
    material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set('diffusePS', voxelArrayDiffuseWgsl);
    material.setParameter('texture_voxelArray', textureArray);
    if (category === 'cutout' || category === 'transparent') {
      material.opacityMap = tiles.get(sampleId)!;
      material.opacityMapChannel = 'a';
      material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('opacityPS', voxelArrayOpacityGlsl);
      material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set('opacityPS', voxelArrayOpacityWgsl);
    }
    if (category === 'cutout') {
      material.alphaTest = mix(0.36, 0.12, quality.vegetationDensity);
      material.twoSidedLighting = true;
    }
    if (category === 'transparent') {
      material.emissive = new pc.Color(0.02, 0.11, 0.15);
      material.opacity = mix(0.5, 0.68, quality.waterQuality);
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
      material.opacityFadesSpecular = false;
    }
    material.update();
    return material;
  };
  const categoryMaterials = new Map<RenderCategory, pc.StandardMaterial>([
    ['opaque', createCategoryMaterial('opaque')],
    ['cutout', createCategoryMaterial('cutout')],
    ['transparent', createCategoryMaterial('transparent')],
  ]);
  return {
    categoryMaterials,
    resolve: (part) => categoryMaterials.get(part.renderCategory)!,
    water: [categoryMaterials.get('transparent')!],
    destroy: () => {
      categoryMaterials.forEach((material) => material.destroy());
      tiles.forEach((texture) => texture.destroy());
      textureArray.destroy();
    },
  };
}
