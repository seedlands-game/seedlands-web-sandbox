import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { voxelAppearanceEmissionGlsl } from '../../../src/app/shaders/voxel-appearance-chunks';
import { voxelWaterReflectionEmissionGlsl } from '../../../src/app/shaders/voxel-array-chunks';

const emissionExpression = (shader: string) => shader.match(/dEmission\s*=\s*([^;]+);/)?.[1] ?? '';

describe('表面受光 shader source 合同（不替代 GPU 像素验收）', () => {
  it.each([
    ['terrain', voxelAppearanceEmissionGlsl],
    ['water', voxelWaterReflectionEmissionGlsl],
  ])('%s 的 received block light 不写入 self-emission', (_consumer, shader) => {
    expect(emissionExpression(shader)).not.toContain('blockLightAtSurface');
    expect(emissionExpression(shader)).not.toContain('skyLightAtSurface');
  });

  it('self-emission 仍由各材质自己的发光输入产生', () => {
    expect(emissionExpression(voxelAppearanceEmissionGlsl)).toContain('uVoxelEmission');
    expect(emissionExpression(voxelWaterReflectionEmissionGlsl)).toContain('material_emissive');
  });

  it('terrain 与 water 通过 WebGL2 lightmap 通道合成 block 和 sky received light', () => {
    const lightingSources = [
      source('apps/web/src/app/shaders/voxel-block-light-chunk.ts'),
      source('apps/web/src/app/shaders/voxel-received-light-chunk.ts'),
      source('apps/web/src/app/shaders/voxel-appearance-chunks.ts'),
      source('apps/web/src/app/shaders/voxel-array-chunks.ts'),
      source('apps/web/src/app/scene/voxel-materials.ts'),
    ].join('\n');

    expect(lightingSources).toContain('blockLightAtSurface()');
    expect(lightingSources).toContain('skyLightAtSurface()');
    expect(lightingSources).toContain('dLightmap');
    expect(lightingSources).toContain("set('lightmapPS'");
  });
});

function source(path: string): string {
  return readFileSync(path, 'utf8');
}
