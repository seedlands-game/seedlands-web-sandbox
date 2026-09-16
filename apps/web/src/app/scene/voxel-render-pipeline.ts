import { FaceMaterial, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { RenderCategory } from '@seedlands/stdlib/world/mesh';
export type { RenderCategory } from '@seedlands/stdlib/world/mesh';

export const MATERIAL_LAYER_COUNT = 18;

export const FINAL_RENDER_PIPELINE = {
  drawUnit: 'chunk-render-category',
  batchMode: 'category',
  vertexLayout: 'float16-uv-uint16-index',
  shaderMode: 'voxel-array-chunks',
  backend: 'webgl2',
} as const;

export type RenderPipelineSnapshot = Omit<typeof FINAL_RENDER_PIPELINE, 'backend'> & {
  backend: 'webgl2' | 'webgpu';
};

export function renderCategoryForFaceMaterial(material: FaceMaterialId): RenderCategory {
  if (material === FaceMaterial.Leaves) return 'cutout';
  if (material === FaceMaterial.Water) return 'transparent';
  if (material === FaceMaterial.LanternGlow) return 'emissive';
  return 'opaque';
}

export const shaderInventory = [
  { name: 'voxel-array-diffuse', stage: 'fragment', passes: ['forward'], languages: ['glsl', 'wgsl'] },
  {
    name: 'voxel-array-opacity',
    stage: 'fragment',
    passes: ['forward', 'depth', 'shadow'],
    languages: ['glsl', 'wgsl'],
  },
] as const;
