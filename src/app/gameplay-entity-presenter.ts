import * as pc from 'playcanvas';
import type { GameplayEntity } from '../server/gameplay/entity-store';
import { movementPose, damageFlash } from '../client/entity-presentation-motion';

const createMaterial = (color: pc.Color) => {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color.clone().mulScalar(0.035);
  material.gloss = 0.15;
  material.update();
  return material;
};

export class GameplayEntityPresenter {
  private lastTime: number | null = null;
  private readonly presented = new Map<string, pc.Entity>();
  private readonly previousPositions = new Map<string, [number, number, number]>();
  private readonly health = new Map<string, number>();
  private readonly hurtUntil = new Map<string, number>();
  private readonly originalMaterials = new WeakMap<pc.Entity, pc.StandardMaterial>();
  private readonly materials = {
    item: createMaterial(new pc.Color(0.72, 0.9, 0.42)),
    grazer: createMaterial(new pc.Color(0.49, 0.35, 0.22)),
    stalker: createMaterial(new pc.Color(0.38, 0.16, 0.48)),
    settler: createMaterial(new pc.Color(0.16, 0.31, 0.33)),
    accent: createMaterial(new pc.Color(0.72, 0.56, 0.31)),
    skin: createMaterial(new pc.Color(0.68, 0.49, 0.33)),
    cream: createMaterial(new pc.Color(0.79, 0.72, 0.53)),
    dark: createMaterial(new pc.Color(0.085, 0.11, 0.12)),
    berry: createMaterial(new pc.Color(0.48, 0.16, 0.34)),
    stone: createMaterial(new pc.Color(0.42, 0.49, 0.51)),
    glow: createMaterial(new pc.Color(1, 0.72, 0.31)),
    hurt: createMaterial(new pc.Color(0.94, 0.2, 0.12)),
  };

  constructor(private readonly app: pc.Application) {}

  reconcile(entities: readonly GameplayEntity[], time: number): void {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    const current = new Set(entities.map((entity) => entity.id));
    this.presented.forEach((node, id) => {
      if (current.has(id)) return;
      node.destroy();
      this.presented.delete(id);
      this.previousPositions.delete(id);
      this.health.delete(id);
      this.hurtUntil.delete(id);
    });
    entities.forEach((entity) => {
      const node = this.presented.get(entity.id) ?? this.create(entity);
      const previous = this.previousPositions.get(entity.id);
      const snap = !previous || Math.hypot(...entity.position.map((value, axis) => value - previous[axis])) > 4;
      const position: [number, number, number] = snap
        ? [...entity.position]
        : (entity.position.map(
            (value, axis) => previous[axis] + (value - previous[axis]) * (1 - Math.exp(-dt / 0.055)),
          ) as [number, number, number]);
      const pose = movementPose(previous, position, time);
      if (pose.yaw !== null) node.setEulerAngles(0, pose.yaw, 0);
      const oldHealth = this.health.get(entity.id);
      if (entity.health !== undefined) {
        if (oldHealth !== undefined && entity.health < oldHealth) this.hurtUntil.set(entity.id, time + 0.25);
        this.health.set(entity.id, entity.health);
      }
      const flash = damageFlash(time, this.hurtUntil.get(entity.id) ?? 0);
      const scale = 1 + flash * 0.05;
      node.setLocalScale(scale, scale, scale);
      if (entity.type === 'world-item') node.setEulerAngles(0, time * 24, 0);
      node.setPosition(position[0], position[1] + (entity.type === 'world-item' ? 0.1 : pose.bob), position[2]);
      for (const child of node.children) {
        const part = child as pc.Entity;
        const material = this.originalMaterials.get(part);
        if (part.render && material) part.render.material = flash > 0 ? this.materials.hurt : material;
        if (/leg-|front-|back-|arm-/.test(part.name))
          part.setLocalEulerAngles(pose.stride * (part.name.includes('left') ? 1 : -1), 0, 0);
      }
      this.previousPositions.set(entity.id, position);
    });
  }

  dispose(): void {
    this.presented.forEach((entity) => entity.destroy());
    this.presented.clear();
    this.lastTime = null;
    this.previousPositions.clear();
    this.health.clear();
    this.hurtUntil.clear();
    Object.values(this.materials).forEach((material) => material.destroy());
  }

  private create(entity: GameplayEntity): pc.Entity {
    const node = new pc.Entity(`gameplay:${entity.id}`);
    if (entity.type === 'world-item') this.createItem(node, entity.stack?.itemId ?? '');
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
    this.addPart(node, 'muzzle', 'box', this.materials.cream, [0, 1.32, -1.02], [0.36, 0.24, 0.42]);
    this.addPart(node, 'ear-left', 'cone', this.materials.accent, [-0.22, 1.78, -0.7], [0.16, 0.4, 0.16]);
    this.addPart(node, 'ear-right', 'cone', this.materials.accent, [0.22, 1.78, -0.7], [0.16, 0.4, 0.16]);
    this.addQuadrupedLegs(node, this.materials.dark);
    this.addPart(node, 'chest', 'box', this.materials.cream, [0, 0.66, -0.55], [0.52, 0.44, 0.12]);
    this.addEyes(node, 1.48, -0.84, 0.22);
  }

  private createStalker(node: pc.Entity): void {
    this.addPart(node, 'body', 'capsule', this.materials.stalker, [0, 0.88, 0], [0.88, 1.34, 0.88]);
    this.addPart(node, 'head', 'sphere', this.materials.stalker, [0, 1.72, -0.24], [0.72, 0.58, 0.72]);
    this.addPart(node, 'crest', 'cone', this.materials.accent, [0, 2.34, -0.18], [0.3, 0.72, 0.3]);
    this.addPart(node, 'claw-left', 'cone', this.materials.accent, [-0.52, 0.28, -0.24], [0.18, 0.54, 0.18]);
    this.addPart(node, 'claw-right', 'cone', this.materials.accent, [0.52, 0.28, -0.24], [0.18, 0.54, 0.18]);
    this.addEyes(node, 1.78, -0.57, 0.2, this.materials.glow);
  }

  private createSettler(node: pc.Entity): void {
    this.addPart(node, 'body', 'box', this.materials.settler, [0, 1.08, 0], [0.84, 1.32, 0.62]);
    this.addPart(node, 'head', 'sphere', this.materials.skin, [0, 2.02, 0], [0.62, 0.62, 0.62]);
    this.addPart(node, 'belt', 'box', this.materials.accent, [0, 0.82, 0], [0.87, 0.14, 0.65]);
    this.addPart(node, 'hair', 'box', this.materials.dark, [0, 2.23, 0.03], [0.61, 0.19, 0.6]);
    this.addEyes(node, 2.04, -0.28, 0.13);
    this.addPart(node, 'pack', 'box', this.materials.grazer, [0, 1.16, 0.46], [0.68, 0.76, 0.3]);
    this.addPart(node, 'arm-left', 'capsule', this.materials.settler, [-0.58, 1.08, 0], [0.22, 0.9, 0.22]);
    this.addPart(node, 'arm-right', 'capsule', this.materials.settler, [0.58, 1.08, 0], [0.22, 0.9, 0.22]);
    this.addPart(node, 'leg-left', 'capsule', this.materials.dark, [-0.24, 0.28, 0], [0.26, 0.72, 0.26]);
    this.addPart(node, 'leg-right', 'capsule', this.materials.dark, [0.24, 0.28, 0], [0.26, 0.72, 0.26]);
  }

  private createItem(node: pc.Entity, itemId: string) {
    if (itemId === 'berry') {
      for (const [x, y] of [
        [-0.1, 0],
        [0.1, 0],
        [0, -0.12],
      ])
        this.addPart(node, 'berry', 'sphere', this.materials.berry, [x, y, 0], [0.23, 0.23, 0.23]);
      this.addPart(node, 'leaf', 'box', this.materials.item, [0.06, 0.17, 0], [0.16, 0.06, 0.1]);
    } else if (itemId === 'lantern') {
      this.addPart(node, 'lantern', 'box', this.materials.glow, [0, 0, 0], [0.23, 0.3, 0.23]);
      for (const y of [-0.19, 0.19])
        this.addPart(node, 'rim', 'box', this.materials.accent, [0, y, 0], [0.32, 0.06, 0.32]);
    } else {
      const material = itemId.includes('stone') ? this.materials.stone : this.materials.grazer;
      this.addPart(node, 'item', 'box', material, [0, 0, 0], [0.36, 0.36, 0.36]);
    }
  }

  private addEyes(node: pc.Entity, y: number, z: number, x: number, material = this.materials.dark) {
    for (const side of [-1, 1]) this.addPart(node, 'eye', 'box', material, [x * side, y, z], [0.07, 0.07, 0.045]);
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
    this.originalMaterials.set(part, material);
    part.setLocalPosition(...position);
    part.setLocalScale(...scale);
    parent.addChild(part);
  }
}
