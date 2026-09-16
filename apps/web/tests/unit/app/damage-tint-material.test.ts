import { expect, it } from 'vitest';
import * as pc from 'playcanvas';
import { createDamageTintMaterial, DAMAGE_TINT_STYLE } from '../../../src/app/gameplay/damage-tint-material';

it('透明红色受击材质保留原贴图且不修改共享原材质', () => {
  const source = new pc.StandardMaterial();
  source.name = 'textured-creature';
  const texture = {} as pc.Texture;
  source.diffuseMap = texture;
  source.opacity = 1;
  const tinted = createDamageTintMaterial(source);

  expect(tinted).not.toBe(source);
  expect(tinted.diffuseMap).toBe(texture);
  expect(tinted.opacity).toBe(DAMAGE_TINT_STYLE.opacity);
  expect(tinted.blendType).toBe(pc.BLEND_NORMAL);
  expect([tinted.diffuse.r, tinted.diffuse.g, tinted.diffuse.b]).toEqual([...DAMAGE_TINT_STYLE.diffuse]);
  expect(source.opacity).toBe(1);
  expect(source.diffuse.r).toBe(1);
  tinted.destroy();
  source.destroy();
});
