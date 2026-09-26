import type { ItemDefinition } from '@seedlands/stdlib/server/gameplay/item-registry';
import * as pc from 'playcanvas';
import type { GameplayEntityView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { damageFlash, movementPose } from '../../client/presentation/entity-presentation-motion';
import type { AppearanceAnimationBinding, AppearanceProject } from '../../client/presentation/appearance-project';
import { classicCreatureDefinition } from '../../client/presentation/classic-creature-definitions';
import { getAppearanceAnimationBindings, getAppearanceModelBlob, getPackActorPresentation } from './appearance-runtime';
import { acquireGameplayModelAssets, type GameplayModelAssetsLease } from './gameplay-model-assets';
import { addGlbModel, type GlbModelLease } from './glb-model-resource';
import {
  createModelAnimationController,
  type ModelAnimationClips,
  type ModelAnimationController,
} from './model-animation';
import { createDamageTintMaterial } from './damage-tint-material';
import type { VoxelGeometryResolver } from '@seedlands/stdlib/world/voxel-model';

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

export type GameplayBlockLightSampler = (position: readonly [number, number, number]) => number;

export class GameplayEntityPresenter {
  private presentationTime = 0;
  private readonly presented = new Map<string, pc.Entity>();
  private readonly previousPositions = new Map<string, [number, number, number]>();
  private readonly health = new Map<string, number>();
  private readonly hurtUntil = new Map<string, number>();
  private readonly originalMaterials = new WeakMap<pc.Entity, pc.StandardMaterial>();
  private readonly damageMaterials = new WeakMap<pc.Entity, pc.StandardMaterial>();
  private readonly originalEmissionIntensity = new WeakMap<pc.Entity, number>();
  private readonly damageEmissionIntensity = new WeakMap<pc.Entity, number>();
  private readonly damageMaterialResources = new Set<pc.StandardMaterial>();
  private readonly clonedMaterialResources = new Set<pc.StandardMaterial>();
  private readonly animated = new Map<string, AnimatedEntity>();
  private readonly movingShadowCasters = new Map<string, boolean>();
  private readonly shadowCasterRevisions = new Map<string, number>();
  private readonly assetsLease: GameplayModelAssetsLease;
  private readonly bindings: NonNullable<AppearanceProject['animationBindings']>;

  constructor(
    private readonly app: pc.Application,
    private readonly resolveItem?: (id: string) => ItemDefinition | null,
    private readonly sampleBlockLight?: GameplayBlockLightSampler,
    voxelGeometry?: VoxelGeometryResolver,
  ) {
    this.assetsLease = acquireGameplayModelAssets(app, voxelGeometry);
    this.bindings = getAppearanceAnimationBindings(app);
  }

  reconcile(entities: readonly GameplayEntityView[], renderDeltaSeconds = 0): void {
    const dt = Number.isFinite(renderDeltaSeconds) ? Math.max(0, Math.min(0.1, renderDeltaSeconds)) : 0;
    this.presentationTime += dt;
    const current = new Set(entities.map((entity) => entity.id));
    this.presented.forEach((node, id) => {
      if (current.has(id)) return;
      this.releaseDamageMaterials(node);
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
    this.presented.forEach((entity) => {
      this.releaseDamageMaterials(entity);
      entity.destroy();
    });
    this.presented.clear();
    this.previousPositions.clear();
    this.health.clear();
    this.hurtUntil.clear();
    this.movingShadowCasters.clear();
    this.shadowCasterRevisions.clear();
    for (const id of this.animated.keys()) this.releaseAnimated(id);
    this.damageMaterialResources.forEach((material) => material.destroy());
    this.damageMaterialResources.clear();
    this.clonedMaterialResources.forEach((material) => material.destroy());
    this.clonedMaterialResources.clear();
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
    node.setPosition(position[0], position[1] + (entity.type === 'world-item' ? 0.1 : 0), position[2]);
    const blockLight = Math.max(
      0,
      Math.min(1, this.sampleBlockLight?.([position[0], position[1] + 0.7, position[2]]) ?? 0),
    );
    this.forEachRender(node, (part) => {
      const material = this.originalMaterials.get(part);
      const damageMaterial = this.damageMaterials.get(part);
      if (material) material.emissiveIntensity = (this.originalEmissionIntensity.get(part) ?? 0) + blockLight * 0.72;
      if (damageMaterial)
        damageMaterial.emissiveIntensity = (this.damageEmissionIntensity.get(part) ?? 0) + blockLight * 0.72;
      if (part.render && material) part.render.material = flash > 0 && damageMaterial ? damageMaterial : material;
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
    if (entity.type === 'world-item')
      this.assets.addItem(
        visual,
        entity.stack?.itemId ?? '',
        1,
        undefined,
        this.resolveItem?.(entity.stack?.itemId ?? ''),
      );
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
      const builtin = classicCreatureDefinition(target);
      const pack = getPackActorPresentation(this.app, target);
      const override = (this.bindings as Partial<Record<string, AppearanceAnimationBinding>>)[target];
      const binding = override ?? builtin ?? (pack ? { modelId: `pack:${target}`, clips: {} } : undefined);
      if (state.abort.signal.aborted) return;
      if (!binding) throw new Error(`未登记物种模型：${target}`);
      const blob = override ? getAppearanceModelBlob(this.app, binding.modelId) : undefined;
      if (override && !blob) throw new Error(`外观模型快照缺失：${binding.modelId}`);
      const lease = await addGlbModel(
        this.app,
        visual,
        binding.modelId,
        state.abort.signal,
        blob,
        override ? 'feet' : 'authored',
        pack?.url,
      );
      if (state.abort.signal.aborted || this.animated.get(entityId) !== state) {
        lease.release();
        return;
      }
      const clips = this.availableClips(binding, lease.animationClips);
      if ((!lease.playback || !Object.keys(clips).length) && !pack) {
        lease.release();
        throw new Error(`物种模型缺少可播放动作：${binding.modelId}`);
      }
      for (const child of [...visual.children]) if (child !== lease.entity) (child as pc.Entity).destroy();
      this.registerDamageMaterials(lease.entity);
      state.lease = lease;
      state.controller = lease.playback ? createModelAnimationController(clips, lease.playback) : null;
      this.shadowCasterRevisions.set(entityId, (this.shadowCasterRevisions.get(entityId) ?? 0) + 1);
    } catch (error) {
      if (state.abort.signal.aborted || this.animated.get(entityId) !== state) return;
      const message = `生物外观加载失败（${target}）：${error instanceof Error ? error.message : String(error)}`;
      console.error(message);
      this.app.fire('seedlands:asset-error', message);
      this.assets.addBox(
        visual,
        `asset-error:${target}`,
        'glow-eye',
        { x: 0, y: 0.65, z: 0 },
        { x: 0.12, y: 0.6, z: 0.12 },
      );
      this.assets.addBox(visual, 'asset-error-dot', 'glow-eye', { x: 0, y: 0.2, z: 0 }, { x: 0.12, y: 0.12, z: 0.12 });
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
      const original = part.render.material.clone() as pc.StandardMaterial;
      part.render.material = original;
      const damage = createDamageTintMaterial(original);
      this.originalMaterials.set(part, original);
      this.damageMaterials.set(part, damage);
      this.originalEmissionIntensity.set(part, original.emissiveIntensity);
      this.damageEmissionIntensity.set(part, damage.emissiveIntensity);
      this.damageMaterialResources.add(damage);
      this.clonedMaterialResources.add(original);
    });
  }

  private releaseDamageMaterials(root: pc.Entity): void {
    this.forEachRender(root, (part) => {
      const damage = this.damageMaterials.get(part);
      const original = this.originalMaterials.get(part);
      if (damage) {
        damage.destroy();
        this.damageMaterialResources.delete(damage);
      }
      if (original) {
        original.destroy();
        this.clonedMaterialResources.delete(original);
      }
      this.damageMaterials.delete(part);
      this.originalMaterials.delete(part);
      this.originalEmissionIntensity.delete(part);
      this.damageEmissionIntensity.delete(part);
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
