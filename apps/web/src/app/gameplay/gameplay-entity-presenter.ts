import * as pc from 'playcanvas';
import type { GameplayEntity } from '@seedlands/game-core/server/gameplay/entity-store';
import { damageFlash, movementPose } from '../../client/presentation/entity-presentation-motion';
import { acquireGameplayModelAssets, type GameplayModelAssetsLease } from './gameplay-model-assets';

const PRESENTATION_SETTLE_DISTANCE = 0.001;

export class GameplayEntityPresenter {
  private presentationTime = 0;
  private readonly presented = new Map<string, pc.Entity>();
  private readonly previousPositions = new Map<string, [number, number, number]>();
  private readonly health = new Map<string, number>();
  private readonly hurtUntil = new Map<string, number>();
  private readonly originalMaterials = new WeakMap<pc.Entity, pc.StandardMaterial>();
  private readonly assetsLease: GameplayModelAssetsLease;

  constructor(private readonly app: pc.Application) {
    this.assetsLease = acquireGameplayModelAssets(app);
  }

  reconcile(entities: readonly GameplayEntity[], renderDeltaSeconds = 0): void {
    const dt = Number.isFinite(renderDeltaSeconds) ? Math.max(0, Math.min(0.1, renderDeltaSeconds)) : 0;
    this.presentationTime += dt;
    const current = new Set(entities.map((entity) => entity.id));
    this.presented.forEach((node, id) => {
      if (current.has(id)) return;
      node.destroy();
      this.presented.delete(id);
      this.previousPositions.delete(id);
      this.health.delete(id);
      this.hurtUntil.delete(id);
    });
    entities.forEach((entity) => this.updateEntity(entity, this.presentationTime, dt));
  }

  dispose(): void {
    this.presented.forEach((entity) => entity.destroy());
    this.presented.clear();
    this.previousPositions.clear();
    this.health.clear();
    this.hurtUntil.clear();
    this.assetsLease.release();
    this.presentationTime = 0;
  }

  presentedPosition(id: string): [number, number, number] | null {
    const position = this.presented.get(id)?.getPosition();
    return position ? [position.x, position.y, position.z] : null;
  }

  private updateEntity(entity: GameplayEntity, time: number, dt: number): void {
    const node = this.presented.get(entity.id) ?? this.create(entity);
    const previous = this.previousPositions.get(entity.id);
    const snap = !previous || Math.hypot(...entity.position.map((value, axis) => value - previous[axis])) > 4;
    let position = snap
      ? ([...entity.position] as [number, number, number])
      : (entity.position.map(
          (value, axis) => previous[axis] + (value - previous[axis]) * (1 - Math.exp(-dt / 0.055)),
        ) as [number, number, number]);
    if (
      !snap &&
      Math.hypot(...position.map((value, axis) => value - entity.position[axis])) <= PRESENTATION_SETTLE_DISTANCE
    )
      position = [...entity.position];
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
    this.forEachRender(node, (part) => {
      const material = this.originalMaterials.get(part);
      if (part.render && material) part.render.material = flash > 0 ? this.assets.materials.hurt : material;
      if (/leg-|front-|back-|arm-/.test(part.name))
        part.setLocalEulerAngles(pose.stride * (part.name.includes('left') ? 1 : -1), 0, 0);
    });
    this.previousPositions.set(entity.id, position);
  }

  private create(entity: GameplayEntity): pc.Entity {
    const node = new pc.Entity(`gameplay:${entity.id}`);
    const visual = new pc.Entity(`${node.name}:visual`);
    // movementPose's yaw defines local -Z as forward. Keep authored facial layout independent of that shared contract.
    if (entity.type !== 'world-item') visual.setLocalEulerAngles(0, 180, 0);
    node.addChild(visual);
    if (entity.type === 'world-item') this.assets.addItem(visual, entity.stack?.itemId ?? '', 1);
    else if (entity.archetype === 'grazer') this.createGrazer(visual);
    else if (entity.archetype === 'night-stalker') this.createStalker(visual);
    else if (entity.archetype === 'settler') this.createSettler(visual);
    else this.addPart(visual, 'fallback-body', 'charcoal', [0, 0.75, 0], [0.7, 1.1, 0.7]);
    this.forEachRender(node, (part) => {
      if (part.render?.material instanceof pc.StandardMaterial) this.originalMaterials.set(part, part.render.material);
    });
    this.app.root.addChild(node);
    this.presented.set(entity.id, node);
    return node;
  }

  private createGrazer(node: pc.Entity): void {
    this.addPart(node, 'grazer-body', 'fur', [0, 0.76, 0.08], [0.78, 0.54, 1.28]);
    this.addPart(node, 'grazer-chest-patch', 'cream', [0, 0.77, 0.55], [0.56, 0.42, 0.06]);
    this.addPart(node, 'grazer-neck', 'fur', [0, 1.12, 0.43], [0.34, 0.52, 0.32]);
    this.addPart(node, 'grazer-head', 'fur', [0, 1.42, 0.7], [0.48, 0.4, 0.52]);
    this.addPart(node, 'grazer-muzzle', 'cream', [0, 1.32, 1], [0.38, 0.24, 0.25]);
    this.addPart(node, 'grazer-ear-left', 'fur', [-0.23, 1.74, 0.69], [0.13, 0.26, 0.13]);
    this.addPart(node, 'grazer-ear-right', 'fur', [0.23, 1.74, 0.69], [0.13, 0.26, 0.13]);
    this.addEyes(node, 1.5, 0.97, 0.22);
    this.addQuadrupedLegs(node, 'boot');
  }

  private createStalker(node: pc.Entity): void {
    this.addPart(node, 'stalker-body-rear', 'charcoal', [0, 0.7, 0.3], [0.78, 0.58, 0.72]);
    this.addPart(node, 'stalker-body-front', 'charcoal', [0, 0.85, -0.24], [0.9, 0.68, 0.75]);
    this.addPart(node, 'stalker-head', 'charcoal', [0, 1.31, 0.65], [0.64, 0.48, 0.55]);
    this.addPart(node, 'stalker-jaw', 'teal', [0, 1.12, 0.9], [0.47, 0.14, 0.22]);
    this.addEyes(node, 1.38, 0.94, 0.2, 'glow-eye');
    for (const [name, x] of [
      ['spine-left', -0.24],
      ['spine-mid', 0],
      ['spine-right', 0.24],
    ] as const)
      this.addPart(node, name, 'teal', [x, 1.24, 0.05], [0.12, 0.42, 0.2]);
    this.addQuadrupedLegs(node, 'teal', 0.9);
  }

  private createSettler(node: pc.Entity): void {
    this.addPart(node, 'settler-tunic', 'cloth', [0, 1.06, 0], [0.82, 1.15, 0.58]);
    this.addPart(node, 'settler-belt', 'brass', [0, 0.76, 0], [0.86, 0.12, 0.62]);
    this.addPart(node, 'settler-head', 'skin', [0, 1.89, -0.02], [0.6, 0.58, 0.55]);
    this.addPart(node, 'settler-hair', 'charcoal', [0, 2.15, 0.04], [0.62, 0.18, 0.58]);
    this.addPart(node, 'settler-brow-left', 'charcoal', [-0.15, 2.01, 0.31], [0.13, 0.035, 0.04]);
    this.addPart(node, 'settler-brow-right', 'charcoal', [0.15, 2.01, 0.31], [0.13, 0.035, 0.04]);
    this.addPart(node, 'settler-nose', 'skin', [0, 1.87, 0.33], [0.11, 0.14, 0.09]);
    this.addPart(node, 'settler-beard', 'umber', [0, 1.65, 0.3], [0.36, 0.2, 0.08]);
    this.addEyes(node, 1.93, 0.3, 0.14);
    this.addPart(node, 'settler-pack', 'umber', [0, 1.13, -0.42], [0.63, 0.7, 0.24]);
    for (const [side, x] of [
      ['left', -0.55],
      ['right', 0.55],
    ] as const) {
      this.addPart(node, `arm-${side}`, 'cloth', [x, 1.08, 0], [0.2, 0.78, 0.22]);
      this.addPart(node, `leg-${side}`, 'boot', [x * 0.45, 0.28, 0], [0.25, 0.68, 0.28]);
    }
  }

  private addQuadrupedLegs(node: pc.Entity, material: 'boot' | 'teal', size = 1): void {
    for (const [name, x, z] of [
      ['front-left-leg', -0.3, -0.4],
      ['front-right-leg', 0.3, -0.4],
      ['back-left-leg', -0.3, 0.4],
      ['back-right-leg', 0.3, 0.4],
    ] as const)
      this.addPart(node, name, material, [x, 0.29, z], [0.2 * size, 0.64 * size, 0.22 * size]);
  }

  private addEyes(node: pc.Entity, y: number, z: number, x: number, material: 'eye' | 'glow-eye' = 'eye'): void {
    for (const side of [-1, 1]) this.addPart(node, 'eye', material, [x * side, y, z], [0.08, 0.08, 0.045]);
  }

  private addPart(
    node: pc.Entity,
    name: string,
    material: Parameters<GameplayModelAssetsLease['assets']['addBox']>[2],
    [x, y, z]: [number, number, number],
    [width, height, depth]: [number, number, number],
  ) {
    return this.assets.addBox(node, `${node.name}:${name}`, material, { x, y, z }, { x: width, y: height, z: depth });
  }

  private forEachRender(node: pc.Entity, callback: (part: pc.Entity) => void): void {
    for (const child of node.children) {
      const part = child as pc.Entity;
      if (part.render) callback(part);
      this.forEachRender(part, callback);
    }
  }

  private get assets() {
    return this.assetsLease.assets;
  }
}
