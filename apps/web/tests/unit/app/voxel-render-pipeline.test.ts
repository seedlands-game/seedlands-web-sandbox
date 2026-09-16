import { describe, expect, it } from 'vitest';
import {
  MATERIAL_LAYER_COUNT,
  shaderInventory,
  renderCategoryForFaceMaterial,
} from '../../../src/app/scene/voxel-render-pipeline';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';

describe('voxel render pipeline policy', () => {
  it('maps face materials to four stable render categories', () => {
    expect(renderCategoryForFaceMaterial(FaceMaterial.Stone)).toBe('opaque');
    expect(renderCategoryForFaceMaterial(FaceMaterial.Leaves)).toBe('cutout');
    expect(renderCategoryForFaceMaterial(FaceMaterial.Water)).toBe('transparent');
    expect(renderCategoryForFaceMaterial(FaceMaterial.Glowstone)).toBe('opaque');
    expect(renderCategoryForFaceMaterial(FaceMaterial.LanternFrame)).toBe('opaque');
    expect(renderCategoryForFaceMaterial(FaceMaterial.LanternGlow)).toBe('emissive');
    expect(MATERIAL_LAYER_COUNT).toBe(18);
  });

  it('declares matching GLSL and WGSL chunks for every custom shader responsibility', () => {
    expect(shaderInventory).toEqual([
      { name: 'voxel-array-diffuse', stage: 'fragment', passes: ['forward'], languages: ['glsl', 'wgsl'] },
      {
        name: 'voxel-array-opacity',
        stage: 'fragment',
        passes: ['forward', 'depth', 'shadow'],
        languages: ['glsl', 'wgsl'],
      },
    ]);
  });
});
