import * as pc from 'playcanvas';
import type { GameplayEntity } from '@seedlands/game-core/server/gameplay/entity-store';
import { damageFlash, movementPose } from '../../client/presentation/entity-presentation-motion';
import { addBuiltinActorModel } from './builtin-actor-models';
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
    for (const side of ['left', 'right'] as const)
      node.findByName(`arm-${side}-pivot`)?.setLocalEulerAngles(pose.stride * (side === 'left' ? 1 : -1), 0, 0);
    this.forEachRender(node, (part) => {
      const material = this.originalMaterials.get(part);
      if (part.render && material) part.render.material = flash > 0 ? this.assets.materials.hurt : material;
      if (/leg-|front-|back-/.test(part.name))
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
    else if (entity.archetype === 'grazer') addBuiltinActorModel(this.assets, visual, 'grazer');
    else if (entity.archetype === 'night-stalker') addBuiltinActorModel(this.assets, visual, 'stalker');
    else if (entity.archetype === 'settler') addBuiltinActorModel(this.assets, visual, 'settler');
    else this.assets.addBox(visual, 'fallback-body', 'charcoal', { x: 0, y: 0.75, z: 0 }, { x: 0.7, y: 1.1, z: 0.7 });
    this.forEachRender(node, (part) => {
      if (part.render?.material instanceof pc.StandardMaterial) this.originalMaterials.set(part, part.render.material);
    });
    this.app.root.addChild(node);
    this.presented.set(entity.id, node);
    return node;
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
