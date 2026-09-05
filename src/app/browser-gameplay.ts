import { FirstPersonViewmodel } from './first-person-viewmodel';
import { VoxelTargetOutline } from './voxel-target-outline';
import type { VoxelTarget } from '../client/voxel-target';
import { BROWSER_MIN_BUILD_Y, BROWSER_MAX_BUILD_Y } from './browser-world-limits';
import { entityHitDistance } from '../client/entity-hit-volume';
import type * as pc from 'playcanvas';
import type { GameServer, WorldCommitResult } from '../server/game-server';
import { getItemDefinition } from '../server/gameplay/item-registry';
import { voxelNames } from '../world/voxel';
import { GameplayEntityPresenter } from './gameplay-entity-presenter';
import { projectGameplayUi, type GameplayUiProjection } from './ui/gameplay-ui-projector';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { GameplayPresentationEvent } from '../client/audio/gameplay-audio-events';

type Options = {
  app: pc.Application;
  camera: pc.Entity;
  server: GameServer;
  playerId: string;
  bridge: UiBridge;
  session: UiWorldSession;
  nextHudSequence: () => number;
  nextInteractionSequence: () => number;
  consumeCommit: (commit: WorldCommitResult) => void;
  queueSave: () => void;
  releaseInput: () => void;
  movePlayer: (position: [number, number, number]) => void;
  onPresentation?: (event: GameplayPresentationEvent) => void;
};

export class BrowserGameplay {
  private readonly presenter: GameplayEntityPresenter;
  private readonly viewmodel: FirstPersonViewmodel;
  private readonly outline: VoxelTargetOutline;
  private aimTarget: VoxelTarget | null = null;
  private gestureSeconds = 0;
  private inventoryOpen = false;
  private previousProjection: GameplayUiProjection | undefined;
  private previousHealth: number | null = null;
  private breakProjectionElapsedSeconds = Number.POSITIVE_INFINITY;

  constructor(private readonly options: Options) {
    this.presenter = new GameplayEntityPresenter(options.app);
    this.viewmodel = new FirstPersonViewmodel(options.app, options.camera);
    this.outline = new VoxelTargetOutline(options.app);
  }

  setSuspended(suspended: boolean): void {
    this.viewmodel.setVisible(!suspended && !this.blocksInput);
  }

  setAimTarget(target: VoxelTarget | null): void {
    this.aimTarget = target?.inRange ? target : null;
  }

  updatePlayerPosition(position: [number, number, number]): void {
    this.options.server.updateEntity(this.options.playerId, { position });
  }

  advance(seconds: number): void {
    this.breakProjectionElapsedSeconds += seconds;
    this.outline.update(this.blocksInput ? null : this.aimTarget);
    this.gestureSeconds = Math.max(0, this.gestureSeconds - seconds);
    const state = this.options.server.getPlayerState(this.options.playerId);
    this.viewmodel.setHeldItem(state.inventory[state.selectedSlot]?.itemId ?? null);
    this.viewmodel.setVisible(!this.blocksInput);
    if (!this.gestureSeconds) this.viewmodel.setAction(state.breakAction ? 'mine' : 'idle');
    this.viewmodel.update(seconds);
    const playerBefore = this.options.server.getPlayerState(this.options.playerId);
    const before = playerBefore.breakAction;
    const result = this.options.server.advanceGameplay(seconds);
    result.commits.forEach((commit) => this.options.consumeCommit(commit));
    if (before && result.commits.length) {
      this.feedback(`掉落 · ${voxelNames[before.voxel] ?? '资源'}`, 'success');
      this.present({ kind: 'break', voxel: before.voxel, position: before.position });
      this.options.queueSave();
    }
    for (const pickup of result.pickups) {
      if (pickup.playerId !== this.options.playerId) continue;
      this.feedback('拾取 · 物品已放入背包', 'success');
      this.present({ kind: 'pickup', position: pickup.position });
      this.options.queueSave();
    }
    const health = this.options.server.getPlayerState(this.options.playerId).health;
    if (health < playerBefore.health) {
      this.feedback(`受击 · 生命 -${playerBefore.health - health}`, 'error');
      this.options.queueSave();
    }
    this.refresh(false);
  }

  refresh(forceBreakProjection = true): void {
    const player = this.options.server.getPlayerState(this.options.playerId);
    const becameDead = player.lifecycle === 'dead' && this.previousProjection?.shell.gameplay.lifecycle !== 'dead';
    if (becameDead) this.inventoryOpen = false;
    const entities = this.options.server.queryEntities().filter((entity) => entity.type !== 'player');
    const actorStates = new Map(
      entities.flatMap((entity) => {
        const actor = this.options.server.getActorState(entity.id);
        return actor ? [[entity.id, actor] as const] : [];
      }),
    );
    this.presenter.reconcile(entities, this.options.server.gameplayTime);
    if (this.previousHealth !== null && player.health < this.previousHealth) this.present({ kind: 'damage' });
    this.previousHealth = player.health;
    const currentBreaking = player.breakAction
      ? {
          progress: Math.min(1, player.breakAction.elapsedSeconds / player.breakAction.requiredSeconds),
          label: voxelNames[player.breakAction.voxel] ?? '体素',
        }
      : null;
    const previousBreaking = this.previousProjection?.interaction.breaking;
    const breaking =
      !forceBreakProjection &&
      currentBreaking &&
      previousBreaking &&
      currentBreaking.label === previousBreaking.label &&
      this.breakProjectionElapsedSeconds < 0.05
        ? previousBreaking
        : currentBreaking;
    if (breaking !== previousBreaking || forceBreakProjection) this.breakProjectionElapsedSeconds = 0;
    const projection = projectGameplayUi(
      {
        revision: this.options.server.gameplayRevision,
        player: {
          lifecycle: player.lifecycle,
          health: player.health,
          hunger: player.hunger,
          selectedHotbarSlot: player.selectedSlot,
          inventory: player.inventory,
        },
        inventoryOpen: this.inventoryOpen,
        craftableRecipeIds: this.options.server.listCraftableRecipes(this.options.playerId).map((recipe) => recipe.id),
        target:
          this.aimTarget && !this.blocksInput
            ? {
                kind: 'voxel',
                id: this.aimTarget.position.join(','),
                label: voxelNames[this.aimTarget.voxel] ?? '体素',
                voxel: this.aimTarget.voxel,
              }
            : null,
        breaking,
      },
      this.previousProjection,
    );
    this.previousProjection = projection;
    this.options.session.publishHud(this.options.nextHudSequence(), projection.hud);
    this.options.bridge.publishShell(projection.shell);
    if (becameDead) this.options.releaseInput();
    this.options.session.publishInteraction(this.options.nextInteractionSequence(), {
      ...projection.interaction,
      presentedEntities: entities.map((entity) => ({
        id: entity.id,
        type: entity.type as 'world-item' | 'creature' | 'npc',
        position: [...entity.position] as [number, number, number],
        ...(entity.archetype ? { archetype: entity.archetype } : {}),
        ...(actorStates.get(entity.id) ? { behavior: actorStates.get(entity.id)!.behavior } : {}),
        label:
          entity.type === 'world-item' && entity.stack
            ? `${getItemDefinition(entity.stack.itemId).name}掉落物`
            : entity.archetype === 'grazer'
              ? '温顺林鹿'
              : entity.archetype === 'night-stalker'
                ? '夜行兽'
                : entity.archetype === 'settler'
                  ? '营地居民'
                  : '生物',
      })),
    });
  }

  selectHotbarSlot(slot: number): void {
    const result = this.options.server.selectHotbarSlot(this.options.playerId, slot);
    if (!result.success) return this.feedback('快捷栏槽位无效', 'error');
    this.refresh();
  }

  toggleInventory(): void {
    if (this.options.server.getPlayerState(this.options.playerId).lifecycle === 'dead') return;
    this.inventoryOpen = !this.inventoryOpen;
    if (this.inventoryOpen) this.options.releaseInput();
    this.refresh();
  }

  closeInventory(): void {
    if (!this.inventoryOpen) return;
    this.inventoryOpen = false;
    this.refresh();
  }

  craftRecipe(recipeId: string): void {
    const result = this.options.server.craft(this.options.playerId, recipeId);
    this.feedback(result.success ? '合成完成' : `合成失败 · ${result.reason}`, result.success ? 'success' : 'error');
    if (result.success) {
      this.options.queueSave();
      this.present({ kind: 'craft' });
    }
    this.refresh();
  }

  attackTarget(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    maxDistance: number,
  ): boolean {
    const target = this.options.server
      .queryEntities()
      .filter((entity) => entity.type === 'creature' || entity.type === 'npc')
      .map((entity) => ({
        entity,
        distance: entityHitDistance(entity.position, entity.archetype, origin, direction, maxDistance),
      }))
      .filter((hit): hit is typeof hit & { distance: number } => hit.distance !== null)
      .sort((left, right) => left.distance - right.distance)[0]?.entity;
    if (!target) return false;
    const result = this.options.server.attackEntity(this.options.playerId, target.id);
    this.feedback(result.success ? '攻击命中' : `攻击失败 · ${result.reason}`, result.success ? 'success' : 'error');
    if (result.success) this.present({ kind: 'attack', position: target.position });
    if (result.success) this.options.queueSave();
    this.refresh();
    return true;
  }

  beginBreak(position: [number, number, number]): void {
    if (position[1] <= BROWSER_MIN_BUILD_Y) return this.feedback('已到达浏览器世界底层；保留基底石层', 'error');
    if (position[1] > BROWSER_MAX_BUILD_Y) return this.feedback(`采集高度限 1–${BROWSER_MAX_BUILD_Y} 层`, 'error');
    const result = this.options.server.beginBreak(this.options.playerId, position);
    if (!result.success) this.feedback(`无法采集 · ${result.reason}`, 'error');
    this.refresh();
  }

  cancelBreak(): void {
    this.options.server.cancelBreak(this.options.playerId);
    this.refresh();
  }

  place(position: [number, number, number]): void {
    if (position[1] < BROWSER_MIN_BUILD_Y || position[1] > BROWSER_MAX_BUILD_Y)
      return this.feedback(`建造高度限 ${BROWSER_MIN_BUILD_Y}–${BROWSER_MAX_BUILD_Y} 层；物品已保留`, 'error');
    const result = this.options.server.placeVoxel(this.options.playerId, position);
    if (!result.success) return this.feedback(`无法放置 · ${result.reason}`, 'error');
    this.options.consumeCommit(result.commit);
    this.options.queueSave();
    this.feedback('放置 · 方块', 'success');
    this.present({ kind: 'place', voxel: this.options.server.getVoxel(...position), position });
    this.refresh();
  }

  respawn(): void {
    const result = this.options.server.respawnPlayer(this.options.playerId);
    if (!result.success) return;
    const entity = this.options.server.getEntity(this.options.playerId);
    if (entity) this.options.movePlayer(entity.position);
    this.options.queueSave();
    this.refresh();
  }

  moveInventorySlot(source: number, target: number): void {
    const result = this.options.server.moveInventorySlot(this.options.playerId, source, target);
    this.feedback(
      result.success ? '物品已移动' : '无法移动：请检查目标槽位是否已满',
      result.success ? 'success' : 'error',
    );
    if (result.success) this.options.queueSave();
    this.refresh();
  }

  useInventoryItem(slot: number): void {
    const result = this.options.server.useInventoryItem(this.options.playerId, slot);
    const reason = !result.success && result.reason === 'hunger-full' ? '你现在不饿' : '这个物品暂时无法使用';
    this.feedback(result.success ? '食用 · 恢复饥饿' : reason, result.success ? 'success' : 'error');
    if (result.success) {
      this.present({ kind: 'eat' });
      this.options.queueSave();
    }
    this.refresh();
  }

  useHeldItem(): boolean {
    const player = this.options.server.getPlayerState(this.options.playerId);
    const stack = player.inventory[player.selectedSlot];
    if (!stack || getItemDefinition(stack.itemId).itemType !== 'food') return false;
    this.useInventoryItem(player.selectedSlot);
    return true;
  }

  get blocksInput(): boolean {
    return this.inventoryOpen || this.options.server.getPlayerState(this.options.playerId).lifecycle === 'dead';
  }

  get presentedEntityCount(): number {
    return this.options.server.queryEntities().filter((entity) => entity.type !== 'player').length;
  }

  dispose(): void {
    this.presenter.dispose();
    this.viewmodel.dispose();
  }

  private present(event: GameplayPresentationEvent): void {
    this.options.onPresentation?.(event);
    const kind = event.kind;
    if (kind === 'attack' || kind === 'place' || kind === 'eat') {
      this.viewmodel.setAction(kind);
      this.gestureSeconds = 0.42;
    }
    if (kind === 'attack' || kind === 'place' || kind === 'eat' || kind === 'damage') {
      const sequence = this.options.nextInteractionSequence();
      this.options.session.publishInteraction(sequence, { gesture: { kind, sequence } });
    }
  }

  private feedback(message: string, tone: 'info' | 'success' | 'error'): void {
    if (tone === 'error') this.present({ kind: 'rejected' });
    this.options.session.publishFeedback(this.options.nextInteractionSequence(), { message, tone, durationMs: 1_400 });
  }
}
