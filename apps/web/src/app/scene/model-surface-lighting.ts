import * as pc from 'playcanvas';
import { PlayCanvasSurfaceLightingResources } from './playcanvas-surface-lighting';
import { applySurfaceLightingToMaterial, type SurfaceLightingSampler } from './surface-lighting';

type Materials = { original: pc.StandardMaterial; damage?: pc.StandardMaterial };

/** Owns per-instance clones; asset catalog materials and their textures remain borrowed. */
export class ModelSurfaceLighting {
  private readonly materials = new Map<pc.MeshInstance, Materials>();
  private readonly lighting: PlayCanvasSurfaceLightingResources;

  constructor(
    device: pc.GraphicsDevice,
    private readonly sample?: SurfaceLightingSampler,
    private readonly createDamage?: (source: pc.StandardMaterial) => pc.StandardMaterial,
    private readonly category = 'actor',
  ) {
    this.lighting = new PlayCanvasSurfaceLightingResources(device);
  }

  register(root: pc.Entity, category = this.category): void {
    for (const instance of this.instances(root)) {
      if (this.materials.has(instance) || !(instance.material instanceof pc.StandardMaterial)) continue;
      const original = instance.material.clone();
      original.name = `received-lighting:${category}:${original.name}`;
      let damage: pc.StandardMaterial | undefined;
      try {
        damage = this.createDamage?.(original);
        if (this.sample) {
          this.lighting.prepare(original);
          if (damage) this.lighting.prepare(damage);
        }
        this.materials.set(instance, { original, damage });
        instance.material = original;
      } catch (error) {
        damage?.destroy();
        original.destroy();
        throw error;
      }
    }
  }

  apply(root: pc.Entity, position: readonly [number, number, number], hurt = false): void {
    for (const instance of this.instances(root)) {
      const materials = this.materials.get(instance);
      if (!materials) continue;
      const active = hurt && materials.damage ? materials.damage : materials.original;
      if (this.sample)
        applySurfaceLightingToMaterial(
          this.lighting.prepare(active),
          this.sample(position, this.lighting.selfEmission(active)),
        );
      instance.material = active;
    }
  }

  release(root: pc.Entity): void {
    for (const instance of this.instances(root)) {
      const materials = this.materials.get(instance);
      if (!materials) continue;
      materials.damage?.destroy();
      materials.original.destroy();
      this.materials.delete(instance);
    }
  }

  dispose(): void {
    for (const materials of this.materials.values()) {
      materials.damage?.destroy();
      materials.original.destroy();
    }
    this.materials.clear();
    this.lighting.dispose();
  }

  private instances(root: pc.Entity): pc.MeshInstance[] {
    return [
      ...(root.render?.meshInstances ?? []),
      ...root.children.flatMap((child) => this.instances(child as pc.Entity)),
    ];
  }
}
