import * as pc from 'playcanvas';
import type { GameplayEntity } from '../server/gameplay/entity-store';
import type { ActorState } from '../server/simulation/autonomy-runtime';

const createMaterial = (color: pc.Color) => {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color.clone().mulScalar(0.16);
  material.update();
  return material;
};

export class GameplayEntityPresenter {
  private readonly presented = new Map<string, pc.Entity>();
  private readonly previousPositions = new Map<string, [number, number, number]>();
  private readonly materials = {
    item: createMaterial(new pc.Color(0.72, 0.9, 0.42)),
    grazer: createMaterial(new pc.Color(0.64, 0.76, 0.34)),
    stalker: createMaterial(new pc.Color(0.38, 0.16, 0.48)),
    settler: createMaterial(new pc.Color(0.16, 0.55, 0.68)),
    accent: createMaterial(new pc.Color(0.92, 0.68, 0.24)),
  };

  constructor(private readonly app: pc.Application) {}

  reconcile(entities: readonly GameplayEntity[], actors: ReadonlyMap<string, ActorState>, time: number): void {
    const current = new Set(entities.map((entity) => entity.id));
    this.presented.forEach((node, id) => {
      if (current.has(id)) return;
      node.destroy();
      this.presented.delete(id);
      this.previousPositions.delete(id);
    });
    entities.forEach((entity) => {
      const node = this.presented.get(entity.id) ?? this.create(entity);
      const actor = actors.get(entity.id);
      const moving = actor && !['idle', 'attack'].includes(actor.behavior);
      const bob = moving ? Math.abs(Math.sin(time * 8 + entity.id.length)) * 0.08 : 0;
      const verticalOffset = entity.type === 'world-item' ? 0.35 : bob;
      const previous = this.previousPositions.get(entity.id);
      if (previous) {
        const dx = entity.position[0] - previous[0];
        const dz = entity.position[2] - previous[2];
        if (Math.hypot(dx, dz) > 0.001) node.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
      }
      node.setPosition(entity.position[0], entity.position[1] + verticalOffset, entity.position[2]);
      this.previousPositions.set(entity.id, [...entity.position]);
    });
  }

  dispose(): void {
    this.presented.forEach((entity) => entity.destroy());
    this.presented.clear();
    this.previousPositions.clear();
    Object.values(this.materials).forEach((material) => material.destroy());
  }

  private create(entity: GameplayEntity): pc.Entity {
    const node = new pc.Entity(`gameplay:${entity.id}`);
    if (entity.type === 'world-item')
      this.addPart(node, 'item', 'sphere', this.materials.item, [0, 0, 0], [0.52, 0.52, 0.52]);
    else if (entity.archetype === 'grazer') this.createGrazer(node);
    else if (entity.archetype === 'night-stalker') this.createStalker(node);
    else if (entity.archetype === 'settler') this.createSettler(node);
    else this.addPart(node, 'body', 'capsule', this.materials.stalker, [0, 0, 0], [0.62, 0.9, 0.62]);
    this.app.root.addChild(node);
    this.presented.set(entity.id, node);
    return node;
  }

  private createGrazer(node: pc.Entity): void {
    this.addPart(node, 'body', 'box', this.materials.grazer, [0, 0.72, 0], [0.86, 0.62, 1.18]);
    this.addPart(node, 'neck', 'capsule', this.materials.grazer, [0, 1.08, -0.48], [0.34, 0.7, 0.34]);
    this.addPart(node, 'head', 'sphere', this.materials.grazer, [0, 1.42, -0.72], [0.5, 0.42, 0.58]);
    this.addPart(node, 'muzzle', 'box', this.materials.accent, [0, 1.32, -1.02], [0.36, 0.24, 0.42]);
    this.addPart(node, 'ear-left', 'cone', this.materials.accent, [-0.22, 1.78, -0.7], [0.16, 0.4, 0.16]);
    this.addPart(node, 'ear-right', 'cone', this.materials.accent, [0.22, 1.78, -0.7], [0.16, 0.4, 0.16]);
    this.addQuadrupedLegs(node, this.materials.grazer);
  }

  private createStalker(node: pc.Entity): void {
    this.addPart(node, 'body', 'capsule', this.materials.stalker, [0, 0.88, 0], [0.88, 1.34, 0.88]);
    this.addPart(node, 'head', 'sphere', this.materials.stalker, [0, 1.72, -0.24], [0.72, 0.58, 0.72]);
    this.addPart(node, 'crest', 'cone', this.materials.accent, [0, 2.34, -0.18], [0.3, 0.72, 0.3]);
    this.addPart(node, 'claw-left', 'cone', this.materials.accent, [-0.52, 0.28, -0.24], [0.18, 0.54, 0.18]);
    this.addPart(node, 'claw-right', 'cone', this.materials.accent, [0.52, 0.28, -0.24], [0.18, 0.54, 0.18]);
  }

  private createSettler(node: pc.Entity): void {
    this.addPart(node, 'body', 'box', this.materials.settler, [0, 1.08, 0], [0.84, 1.32, 0.62]);
    this.addPart(node, 'head', 'sphere', this.materials.accent, [0, 2.02, 0], [0.62, 0.62, 0.62]);
    this.addPart(node, 'pack', 'box', this.materials.grazer, [0, 1.16, 0.46], [0.68, 0.76, 0.3]);
    this.addPart(node, 'arm-left', 'capsule', this.materials.settler, [-0.58, 1.08, 0], [0.22, 0.9, 0.22]);
    this.addPart(node, 'arm-right', 'capsule', this.materials.settler, [0.58, 1.08, 0], [0.22, 0.9, 0.22]);
    this.addPart(node, 'leg-left', 'capsule', this.materials.settler, [-0.24, 0.28, 0], [0.26, 0.72, 0.26]);
    this.addPart(node, 'leg-right', 'capsule', this.materials.settler, [0.24, 0.28, 0], [0.26, 0.72, 0.26]);
  }

  private addQuadrupedLegs(node: pc.Entity, material: pc.StandardMaterial): void {
    for (const [name, x, z] of [
      ['front-left', -0.3, -0.38],
      ['front-right', 0.3, -0.38],
      ['back-left', -0.3, 0.38],
      ['back-right', 0.3, 0.38],
    ] as const)
      this.addPart(node, name, 'capsule', material, [x, 0.26, z], [0.18, 0.62, 0.18]);
  }

  private addPart(
    parent: pc.Entity,
    name: string,
    type: 'box' | 'capsule' | 'cone' | 'sphere',
    material: pc.StandardMaterial,
    position: [number, number, number],
    scale: [number, number, number],
  ): void {
    const part = new pc.Entity(`${parent.name}:${name}`);
    part.addComponent('render', { type, material, castShadows: true });
    part.setLocalPosition(...position);
    part.setLocalScale(...scale);
    parent.addChild(part);
  }
}
