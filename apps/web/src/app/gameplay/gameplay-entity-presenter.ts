import { ModelSurfaceLighting } from '../scene/model-surface-lighting';
import type { SurfaceLightingSampler } from '../scene/surface-lighting';
import type { ItemDefinition } from '@seedlands/stdlib/server/gameplay/item-registry';
import * as pc from 'playcanvas';
import type {
  AuthorityGameplayView,
  GameplayEntityView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
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
type TransportStateV2 = NonNullable<AuthorityGameplayView['transports']>[number];
type TransportDefinitionV1 = NonNullable<AuthorityGameplayView['transportDefinitions']>[number];

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
  private readonly transportPresentations = new Map<string, string>();
  private readonly previousPositions = new Map<string, [number, number, number]>();
  private readonly health = new Map<string, number>();
  private readonly hurtUntil = new Map<string, number>();
  private readonly surfaceLighting: ModelSurfaceLighting;
  private readonly animated = new Map<string, AnimatedEntity>();
  private readonly movingShadowCasters = new Map<string, boolean>();
  private readonly shadowCasterRevisions = new Map<string, number>();
  private readonly assetsLease: GameplayModelAssetsLease;
  private readonly bindings: NonNullable<AppearanceProject['animationBindings']>;

  constructor(
    private readonly app: pc.Application,
    private readonly resolveItem?: (id: string) => ItemDefinition | null,
    sampleSurfaceLighting?: SurfaceLightingSampler,
    voxelGeometry?: VoxelGeometryResolver,
  ) {
    this.surfaceLighting = new ModelSurfaceLighting(
      app.graphicsDevice,
      sampleSurfaceLighting,
      createDamageTintMaterial,
    );
    this.assetsLease = acquireGameplayModelAssets(app, voxelGeometry);
    this.bindings = getAppearanceAnimationBindings(app);
  }

  reconcile(
    entities: readonly GameplayEntityView[],
    renderDeltaSeconds = 0,
    transports: readonly TransportStateV2[] = [],
    definitions: readonly TransportDefinitionV1[] = [],
  ): void {
    const dt = Number.isFinite(renderDeltaSeconds) ? Math.max(0, Math.min(0.1, renderDeltaSeconds)) : 0;
    this.presentationTime += dt;
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const transportsById = new Map(transports.map((transport) => [transport.reference.entityId, transport]));
    const accepted = entities.filter(
      (entity) => entity.type !== 'transport' || definitionsById.has(transportsById.get(entity.id)?.definitionId ?? ''),
    );
    const current = new Set(accepted.map((entity) => entity.id));
    this.presented.forEach((node, id) => {
      const transport = transportsById.get(id);
      const signature = transport
        ? JSON.stringify([transport.reference.lifetime, definitionsById.get(transport.definitionId)?.presentationId])
        : undefined;
      if (current.has(id) && this.transportPresentations.get(id) === signature) return;
      this.surfaceLighting.release(node);
      node.destroy();
      this.presented.delete(id);
      this.transportPresentations.delete(id);
      this.previousPositions.delete(id);
      this.health.delete(id);
      this.hurtUntil.delete(id);
      this.movingShadowCasters.delete(id);
      this.shadowCasterRevisions.delete(id);
      this.releaseAnimated(id);
    });
    accepted.forEach((entity) => {
      const transport = entity.type === 'transport' ? transportsById.get(entity.id) : undefined;
      const presentationId = transport ? definitionsById.get(transport.definitionId)?.presentationId : undefined;
      if (transport)
        this.transportPresentations.set(entity.id, JSON.stringify([transport.reference.lifetime, presentationId]));
      if (this.updateEntity(entity, this.presentationTime, dt, transport, presentationId))
        this.shadowCasterRevisions.set(entity.id, (this.shadowCasterRevisions.get(entity.id) ?? 0) + 1);
    });
  }

  dispose(): void {
    this.presented.forEach((entity) => {
      this.surfaceLighting.release(entity);
      entity.destroy();
    });
    this.presented.clear();
    this.transportPresentations.clear();
    this.previousPositions.clear();
    this.health.clear();
    this.hurtUntil.clear();
    this.movingShadowCasters.clear();
    this.shadowCasterRevisions.clear();
    for (const id of this.animated.keys()) this.releaseAnimated(id);
    this.surfaceLighting.dispose();
    this.assetsLease.release();
    this.presentationTime = 0;
  }

  presentedPosition(id: string): [number, number, number] | null {
    const position = this.presented.get(id)?.getPosition();
    return position ? [position.x, position.y, position.z] : null;
  }
  presentedModelReady(id: string): boolean {
    return this.animated.get(id)?.lease !== null && this.animated.get(id)?.lease !== undefined;
  }

  get shadowCasters(): readonly GameplayShadowCaster[] {
    return [...this.presented].map(([id, node]) => {
      const position = node.getPosition();
      return { id, revision: this.shadowCasterRevisions.get(id) ?? 0, position: [position.x, position.y, position.z] };
    });
  }

  private updateEntity(
    entity: GameplayEntityView,
    time: number,
    dt: number,
    transport?: TransportStateV2,
    presentationId?: string,
  ): boolean {
    const existing = this.presented.get(entity.id);
    const node = existing ?? this.create(entity, presentationId);
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
    if (transport) node.setEulerAngles(0, (transport.pose.yaw * 180) / Math.PI, 0);
    else if (pose.yaw !== null) node.setEulerAngles(0, pose.yaw, 0);
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
    this.surfaceLighting.apply(node, [position[0], position[1] + 0.7, position[2]], flash > 0);
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

  private create(entity: GameplayEntityView, presentationId?: string): pc.Entity {
    const node = new pc.Entity(`gameplay:${entity.id}`);
    const visual = new pc.Entity(`${node.name}:visual`);
    // movementPose's yaw defines local -Z as forward. Keep authored facial layout independent of that shared contract.
    if (entity.type !== 'world-item' && entity.type !== 'transport') visual.setLocalEulerAngles(0, 180, 0);
    node.addChild(visual);
    if (entity.type === 'world-item')
      this.assets.addItem(
        visual,
        entity.stack?.itemId ?? '',
        1,
        undefined,
        this.resolveItem?.(entity.stack?.itemId ?? ''),
      );
    this.surfaceLighting.register(node, entity.type === 'world-item' ? 'world-item' : 'actor');
    this.app.root.addChild(node);
    this.presented.set(entity.id, node);
    const modelTarget = presentationId ?? entity.archetype;
    if (modelTarget) {
      const animated: AnimatedEntity = {
        abort: new AbortController(),
        lease: null,
        controller: null,
        hurtSequence: 0,
      };
      this.animated.set(entity.id, animated);
      void this.attachAnimatedModel(entity.id, modelTarget, visual, animated);
    }
    return node;
  }

  private async attachAnimatedModel(
    entityId: string,
    target: string,
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
      for (const child of [...visual.children])
        if (child !== lease.entity) {
          this.surfaceLighting.release(child as pc.Entity);
          (child as pc.Entity).destroy();
        }
      try {
        this.surfaceLighting.register(lease.entity);
      } catch (error) {
        this.surfaceLighting.release(lease.entity);
        lease.release();
        throw error;
      }
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
      this.surfaceLighting.register(visual);
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

  private releaseAnimated(id: string): void {
    const animated = this.animated.get(id);
    if (!animated) return;
    animated.abort.abort();
    animated.lease?.release();
    this.animated.delete(id);
  }

  private get assets() {
    return this.assetsLease.assets;
  }
}
