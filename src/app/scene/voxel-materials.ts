import * as pc from 'playcanvas';
import { loadTerrainPack, resolveTerrainTextures } from '../../client/persistence/terrain-pack-store';
import { terrainMaterials } from '../../client/presentation/terrain-assets';
import { pixelCanvas } from '../gameplay/asset-image';
import type { Asset, PixelTexture } from '../../client/presentation/asset-types';
import {
  voxelAppearanceGlossGlsl,
  voxelAppearanceMetalnessGlsl,
  voxelAppearanceEmissionGlsl,
} from '../shaders/voxel-appearance-chunks';
import { FaceMaterial, faceMaterialNames, type FaceMaterialId } from '../../world/voxel';
import type { MeshPart } from '../app-contracts';
import type { QualityProfile } from './quality-profile';
import { MATERIAL_LAYER_COUNT, type RenderCategory } from './voxel-render-pipeline';
import {
  voxelArrayDiffuseGlsl,
  voxelArrayDiffuseWgsl,
  voxelArrayLanternEmissionWgsl,
  voxelArrayOpacityGlsl,
  voxelArrayOpacityWgsl,
  voxelWaterReflectionEmissionGlsl,
} from '../shaders/voxel-array-chunks';

const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

function textureFromCanvas(device: pc.GraphicsDevice, name: string, canvas: HTMLCanvasElement) {
  const texture = new pc.Texture(device, {
    name,
    width: canvas.width,
    height: canvas.height,
    mipmaps: true,
    minFilter: pc.FILTER_NEAREST_MIPMAP_LINEAR,
    magFilter: pc.FILTER_NEAREST,
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
  waterLayer: pc.Layer;
  destroy: () => void;
};

export async function createVoxelMaterials(
  app: pc.Application,
  quality: QualityProfile,
  sources?: PixelTexture[],
  assets?: readonly Asset[],
): Promise<VoxelMaterials> {
  const textures = sources ?? resolveTerrainTextures(await loadTerrainPack());
  const surface: number[] = [];
  const emission: number[] = [];
  const tiles = new Map<FaceMaterialId, pc.Texture>();
  const tileCanvases = new Map<FaceMaterialId, HTMLCanvasElement>();
  for (const definition of terrainMaterials) {
    const material = assets?.find((asset) => asset.id === definition.id && asset.type === 'material');
    const parameters = material?.type === 'material' ? material.payload : undefined;
    const source = textures.find((texture) => texture.id === (parameters?.textureId ?? definition.textureId));
    if (!source) throw new Error(`缺少地形贴图：${definition.textureId}`);
    const canvas = pixelCanvas(source);
    surface.push(
      1 - (parameters?.roughness ?? (definition.renderMode === 'transparent' ? 0.18 : 0.92)),
      parameters?.metalness ?? 0,
    );
    const linearEmission = new pc.Color(...(parameters?.emissive ?? ([1, 0.48, 0.1] as const))).linear();
    emission.push(
      linearEmission.r,
      linearEmission.g,
      linearEmission.b,
      parameters?.emissiveIntensity ?? definition.emissiveIntensity,
    );
    tileCanvases.set(definition.faceMaterial, canvas);
    if (
      [
        FaceMaterial.Stone,
        FaceMaterial.Leaves,
        FaceMaterial.Water,
        FaceMaterial.Glowstone,
        FaceMaterial.LanternGlow,
      ].some((id) => id === definition.faceMaterial)
    )
      tiles.set(
        definition.faceMaterial,
        textureFromCanvas(app.graphicsDevice, faceMaterialNames[definition.faceMaterial], canvas),
      );
  }

  const reflectionFallbackCanvas = document.createElement('canvas');
  reflectionFallbackCanvas.width = 2;
  reflectionFallbackCanvas.height = 2;
  const fallbackContext = reflectionFallbackCanvas.getContext('2d')!;
  fallbackContext.fillStyle = '#17364a';
  fallbackContext.fillRect(0, 0, 2, 2);
  const reflectionFallback = textureFromCanvas(app.graphicsDevice, 'reflection-fallback', reflectionFallbackCanvas);
  const waterLayer = new pc.Layer({ name: 'Voxel Water' });
  // UI 是相机后处理截点；水体须保留主场景深度并一起调色。
  const uiLayer = app.scene.layers.getLayerById(pc.LAYERID_UI);
  const uiIndex = uiLayer ? app.scene.layers.getTransparentIndex(uiLayer) : -1;
  if (uiIndex >= 0) app.scene.layers.insertTransparent(waterLayer, uiIndex);
  else app.scene.layers.pushTransparent(waterLayer);

  const resolution = Math.max(...Array.from(tileCanvases.values(), (canvas) => Math.max(canvas.width, canvas.height)));
  const arrayLayers = Array.from({ length: MATERIAL_LAYER_COUNT }, (_unused, layer) => {
    const canvas = tileCanvases.get((layer + 1) as FaceMaterialId);
    if (!canvas) throw new Error(`Missing voxel texture array layer ${layer}.`);
    if (canvas.width === resolution && canvas.height === resolution) return canvas;
    const normalized = document.createElement('canvas');
    normalized.width = normalized.height = resolution;
    const context = normalized.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, resolution, resolution);
    return normalized;
  });
  const textureArray = new pc.Texture(app.graphicsDevice, {
    name: 'voxel-material-array',
    width: resolution,
    height: resolution,
    arrayLength: MATERIAL_LAYER_COUNT,
    mipmaps: true,
    minFilter: pc.FILTER_NEAREST_MIPMAP_LINEAR,
    magFilter: pc.FILTER_NEAREST,
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
          : category === 'emissive'
            ? FaceMaterial.LanternGlow
            : FaceMaterial.Stone;
    const material = new pc.StandardMaterial();
    material.name = `voxel-${category}`;
    material.diffuse = category === 'transparent' ? new pc.Color(0.52, 0.88, 0.94) : pc.Color.WHITE;
    material.ambient = pc.Color.WHITE;
    material.diffuseMap = tiles.get(sampleId)!;
    material.diffuseVertexColor = true;
    material.gloss = category === 'transparent' ? 0.82 : 0.08;
    material.useMetalness = true;
    material.shaderChunksVersion = '2.8';
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('diffusePS', voxelArrayDiffuseGlsl);
    material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set('diffusePS', voxelArrayDiffuseWgsl);
    material.setParameter('texture_voxelArray', textureArray);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('glossPS', voxelAppearanceGlossGlsl);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('metalnessPS', voxelAppearanceMetalnessGlsl);
    material.setParameter('uVoxelSurface[0]', new Float32Array(surface));
    if (category !== 'transparent') {
      material.emissive = new pc.Color(1, 0.48, 0.1);
      material.emissiveIntensity = category === 'emissive' ? 1.4 : 1.15;
      material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('emissivePS', voxelAppearanceEmissionGlsl);
      material.setParameter('uVoxelEmission[0]', new Float32Array(emission));
      material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set('emissivePS', voxelArrayLanternEmissionWgsl);
    }
    if (category === 'cutout' || category === 'transparent') {
      material.opacityMap = tiles.get(sampleId)!;
      material.opacityMapChannel = 'a';
      material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('opacityPS', voxelArrayOpacityGlsl);
      material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set('opacityPS', voxelArrayOpacityWgsl);
      material.setParameter(
        'uOpacityVoxelLayer',
        category === 'cutout' ? FaceMaterial.Leaves - 1 : FaceMaterial.Water - 1,
      );
    }
    if (category === 'cutout') {
      material.alphaTest = mix(0.34, 0.5, quality.vegetationDensity);
      material.twoSidedLighting = true;
    }
    if (category === 'transparent') {
      material.emissive = new pc.Color(0.02, 0.11, 0.15);
      const waterSource = assets?.find(
        (asset) => asset.id === terrainMaterials.find((entry) => entry.faceMaterial === FaceMaterial.Water)?.id,
      );
      if (waterSource?.type === 'material' && waterSource.source === 'user') {
        material.emissive = new pc.Color(...waterSource.payload.emissive);
        material.emissiveIntensity = waterSource.payload.emissiveIntensity;
      }
      material.opacity = mix(0.56, 0.72, quality.waterQuality);
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
      material.opacityFadesSpecular = false;
      material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('emissivePS', voxelWaterReflectionEmissionGlsl);
      material.setParameter('texture_planarReflection', reflectionFallback);
      material.setParameter('uReflectionTextureMatrix', new pc.Mat4().data);
      material.setParameter('uReflectionStrength', 0);
    }
    material.update();
    return material;
  };
  const categoryMaterials = new Map<RenderCategory, pc.StandardMaterial>([
    ['opaque', createCategoryMaterial('opaque')],
    ['cutout', createCategoryMaterial('cutout')],
    ['emissive', createCategoryMaterial('emissive')],
    ['transparent', createCategoryMaterial('transparent')],
  ]);
  return {
    categoryMaterials,
    resolve: (part) => categoryMaterials.get(part.renderCategory)!,
    water: [categoryMaterials.get('transparent')!],
    waterLayer,
    destroy: () => {
      categoryMaterials.forEach((material) => material.destroy());
      tiles.forEach((texture) => texture.destroy());
      reflectionFallback.destroy();
      textureArray.destroy();
      app.scene.layers.removeTransparent(waterLayer);
    },
  };
}
