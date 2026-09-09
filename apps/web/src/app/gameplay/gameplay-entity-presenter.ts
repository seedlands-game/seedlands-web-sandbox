import * as pc from 'playcanvas';
import type { GameplayEntityView } from '@seedlands/game-core/compute/authority-worker-protocol';
import { damageFlash, movementPose } from '../../client/presentation/entity-presentation-motion';
import type { AppearanceAnimationBinding, AppearanceProject } from '../../client/presentation/appearance-project';
import { addBuiltinActorModel } from './builtin-actor-models';
import { getAppearanceAnimationBindings, getAppearanceModelBlob } from './appearance-runtime';
import { acquireGameplayModelAssets, type GameplayModelAssetsLease } from './gameplay-model-assets';
import { addGlbModel, type GlbModelLease } from './glb-model-resource';
import {
  createModelAnimationController,
  type ModelAnimationClips,
  type ModelAnimationController,
} from './model-animation';
import { createDamageTintMaterial } from './damage-tint-material';

const PRESENTATION_SETTLE_DISTANCE = 0.001;

type AnimatedEntity = {
  abort: AbortController;
  lease: GlbModelLease | null;
  controller: ModelAnimationController | null;
  hurtSequence: number;
};

export type GameplayShadowCaster = Readonly<{
  id: string;
  revision: number;
  position: readonly [number, number, number];
}>;

export class GameplayEntityPresenter {
  private presentationTime = 0;
  private readonly presented = new Map<string, pc.Entity>();
  private readonly previousPositions = new Map<string, [number, number, number]>();
  private readonly health = new Map<string, number>();
  private readonly hurtUntil = new Map<string, number>();
  private readonly originalMaterials = new WeakMap<pc.Entity, pc.StandardMaterial>();
  private readonly damageMaterials = new WeakMap<pc.Entity, pc.StandardMaterial>();
  private readonly damageMaterialResources = new Set<pc.StandardMaterial>();
  private readonly animated = new Map<string, AnimatedEntity>();
  private readonly movingShadowCasters = new Map<string, boolean>();
  private readonly shadowCasterRevisions = new Map<string, number>();
  private readonly assetsLease: GameplayModelAssetsLease;
  private readonly bindings: NonNullable<AppearanceProject['animationBindings']>;

  constructor(private readonly app: pc.Application) {
    this.assetsLease = acquireGameplayModelAssets(app);
    this.bindings = getAppearanceAnimationBindings(app);
  }

  reconcile(entities: readonly GameplayEntityView[], renderDeltaSeconds = 0): void {
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
      this.movingShadowCasters.delete(id);
      this.shadowCasterRevisions.delete(id);
      this.releaseAnimated(id);
    });
    entities.forEach((entity) => {
      if (this.updateEntity(entity, this.presentationTime, dt))
        this.shadowCasterRevisions.set(entity.id, (this.shadowCasterRevisions.get(entity.id) ?? 0) + 1);
    });
  }

  dispose(): void {
    this.presented.forEach((entity) => entity.destroy());
    this.presented.clear();
    this.previousPositions.clear();
    this.health.clear();
    this.hurtUntil.clear();
    this.movingShadowCasters.clear();
    this.shadowCasterRevisions.clear();
    for (const id of this.animated.keys()) this.releaseAnimated(id);
    this.damageMaterialResources.forEach((material) => material.destroy());
    this.damageMaterialResources.clear();
    this.assetsLease.release();
    this.presentationTime = 0;
  }

  presentedPosition(id: string): [number, number, number] | null {
    const position = this.presented.get(id)?.getPosition();
    return position ? [position.x, position.y, position.z] : null;
  }

  get shadowCasters(): readonly GameplayShadowCaster[] {
    return [...this.presented].map(([id, node]) => {
      const position = node.getPosition();
      return { id, revision: this.shadowCasterRevisions.get(id) ?? 0, position: [position.x, position.y, position.z] };
    });
  }

  private updateEntity(entity: GameplayEntityView, time: number, dt: number): boolean {
    const existing = this.presented.get(entity.id);
    const node = existing ?? this.create(entity);
    const beforePosition = node.getPosition().clone();
    const beforeRotation = node.getEulerAngles().clone();
    const beforeScale = node.getLocalScale().clone();
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
      if (oldHealth !== undefined && entity.health < oldHealth) {
        this.hurtUntil.set(entity.id, time + 0.25);
        const animated = this.animated.get(entity.id);
        if (animated) animated.hurtSequence += 1;
      }
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
      const damageMaterial = this.damageMaterials.get(part);
      if (part.render && material) part.render.material = flash > 0 && damageMaterial ? damageMaterial : material;
      if (/leg-|front-|back-/.test(part.name))
        part.setLocalEulerAngles(pose.stride * (part.name.includes('left') ? 1 : -1), 0, 0);
    });
    this.previousPositions.set(entity.id, position);
    const moving =
      previous !== undefined && Math.hypot(...position.map((value, axis) => value - previous[axis])) > 0.001;
    this.animated.get(entity.id)?.controller?.update({
      moving,
      activeAction: entity.combat?.active ?? null,
      hurtSequence:
        time < (this.hurtUntil.get(entity.id) ?? 0) ? (this.animated.get(entity.id)?.hurtSequence ?? null) : null,
    });
    const wasMoving = this.movingShadowCasters.get(entity.id) ?? false;
    this.movingShadowCasters.set(entity.id, moving);
    return (
      existing === undefined ||
      !beforePosition.equals(node.getPosition()) ||
      !beforeRotation.equals(node.getEulerAngles()) ||
      !beforeScale.equals(node.getLocalScale()) ||
      moving ||
      wasMoving !== moving
    );
  }

  private create(entity: GameplayEntityView): pc.Entity {
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
    this.registerDamageMaterials(node);
    this.app.root.addChild(node);
    this.presented.set(entity.id, node);
    if (entity.archetype) {
      const animated: AnimatedEntity = {
        abort: new AbortController(),
        lease: null,
        controller: null,
        hurtSequence: 0,
      };
      this.animated.set(entity.id, animated);
      void this.attachAnimatedModel(entity.id, entity.archetype, visual, animated);
    }
    return node;
  }

  private async attachAnimatedModel(
    entityId: string,
    target: NonNullable<GameplayEntityView['archetype']>,
    visual: pc.Entity,
    state: AnimatedEntity,
  ): Promise<void> {
    try {
      const binding = this.bindings[target];
      if (!binding || state.abort.signal.aborted) return;
      const blob = getAppearanceModelBlob(this.app, binding.modelId);
      if (!blob) return;
      const lease = await addGlbModel(this.app, visual, binding.modelId, state.abort.signal, blob, 'feet');
      if (state.abort.signal.aborted || this.animated.get(entityId) !== state) {
        lease.release();
        return;
      }
      const clips = this.availableClips(binding, lease.animationClips);
      if (!lease.playback || !Object.keys(clips).length) {
        lease.release();
        return;
      }
      for (const child of [...visual.children]) if (child !== lease.entity) (child as pc.Entity).destroy();
      this.registerDamageMaterials(lease.entity);
      state.lease = lease;
      state.controller = createModelAnimationController(clips, lease.playback);
      this.shadowCasterRevisions.set(entityId, (this.shadowCasterRevisions.get(entityId) ?? 0) + 1);
    } catch {
      // A missing or newly replaced local model keeps the existing built-in actor presentation.
    }
  }

  private availableClips(binding: AppearanceAnimationBinding, available: readonly string[]): ModelAnimationClips {
    const names = new Set(available);
    return Object.fromEntries(
      Object.entries(binding.clips).filter((entry): entry is [keyof ModelAnimationClips, string] =>
        names.has(entry[1]),
      ),
    );
  }

  private registerDamageMaterials(root: pc.Entity): void {
    this.forEachRender(root, (part) => {
      if (!(part.render?.material instanceof pc.StandardMaterial) || this.originalMaterials.has(part)) return;
      const original = part.render.material;
      const damage = createDamageTintMaterial(original);
      this.originalMaterials.set(part, original);
      this.damageMaterials.set(part, damage);
      this.damageMaterialResources.add(damage);
    });
  }

  private releaseAnimated(id: string): void {
    const animated = this.animated.get(id);
    if (!animated) return;
    animated.abort.abort();
    animated.lease?.release();
    this.animated.delete(id);
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
