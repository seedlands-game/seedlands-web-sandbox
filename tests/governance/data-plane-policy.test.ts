import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('documents AoS/SoA ownership and the retained WebGL2 backend', () => {
  const policy = readFileSync('AGENTS.md', 'utf8');
  for (const term of ['控制平面', '数据平面', 'AoS', 'SoA', '零拷贝', 'revision', 'WebGL2', 'WebGPU compute'])
    expect(policy).toContain(term);
  const pipeline = readFileSync('src/app/voxel-render-pipeline.ts', 'utf8');
  expect(pipeline).toContain("backend: 'webgl2'");
});
