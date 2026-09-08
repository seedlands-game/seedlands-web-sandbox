import { describe, expect, it } from 'vitest';
import { buildToolMesh, toolModelDefinition } from '../../apps/web/src/client/presentation/voxel-tool-model';

describe('体素工具共享资产', () => {
  it('相邻像素只输出外表面，面朝外且有真实厚度', () => {
    const mesh = buildToolMesh({ pixels: ['aa'], palette: { a: [120, 80, 40] }, grip: [0, 0] });
    expect(mesh.indices.length / 6).toBe(10);
    expect(new Set(mesh.positions.filter((_, index) => index % 3 === 2)).size).toBe(2);
    expect(mesh.colors.length).toBe((mesh.positions.length / 3) * 4);
    expect(mesh.colors[0]).toBeCloseTo(0.18782, 4);
    expect(mesh.colors[3]).toBe(1);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3).map((index) => mesh.positions.slice(index * 3, index * 3 + 3));
      const u = b.map((v, axis) => v - a[axis]);
      const v = c.map((value, axis) => value - a[axis]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const normal = mesh.normals.slice(mesh.indices[i] * 3, mesh.indices[i] * 3 + 3);
      expect(cross.reduce((sum, value, axis) => sum + value * normal[axis], 0)).toBeGreaterThan(0);
    }
  });

  it('木斧和石镐具有不同像素轮廓，单网格和有限三角形', () => {
    const axe = toolModelDefinition('wood-axe')!;
    const pick = toolModelDefinition('stone-pickaxe')!;
    expect(axe.pixels).not.toEqual(pick.pixels);
    expect(toolModelDefinition('berry')).toBeNull();
    expect(toolModelDefinition('constructor')).toBeNull();
    for (const definition of [axe, pick]) {
      expect(definition.pixels).toHaveLength(16);
      expect(definition.pixels.every((row) => row.length === 16)).toBe(true);
      const mesh = buildToolMesh(definition);
      expect(mesh.indices.length / 3).toBeGreaterThan(100);
      expect(mesh.indices.length / 3).toBeLessThan(1000);
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
      expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
    }
  });
});
