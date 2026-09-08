import * as pc from 'playcanvas';

export const DAMAGE_TINT_STYLE = Object.freeze({
  diffuse: Object.freeze([1, 0.24, 0.2] as const),
  emissive: Object.freeze([0.42, 0.025, 0.015] as const),
  emissiveIntensity: 0.7,
  opacity: 0.82,
});

/** 保留原材质贴图和采样设置，只增加类似体素游戏的透明红色受击染色。 */
export function createDamageTintMaterial(source: pc.StandardMaterial): pc.StandardMaterial {
  const material = source.clone();
  material.name = `${source.name || 'material'}:damage-tint`;
  material.diffuse.set(...DAMAGE_TINT_STYLE.diffuse);
  material.emissive.set(...DAMAGE_TINT_STYLE.emissive);
  material.emissiveIntensity = DAMAGE_TINT_STYLE.emissiveIntensity;
  material.opacity = DAMAGE_TINT_STYLE.opacity;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = true;
  material.update();
  return material;
}
