import { FirstPersonViewmodel } from './first-person-viewmodel';
import { VoxelTargetOutline } from './voxel-target-outline';
import type { VoxelTarget } from '../client/voxel-target';
import { BROWSER_MIN_BUILD_Y, BROWSER_MAX_BUILD_Y } from './browser-world-limits';
import { entityHitDistance } from '../client/entity-hit-volume';
import type * as pc from 'playcanvas';
import { getItemDefinition } from '../server/gameplay/item-registry';
import { voxelNames } from '../world/voxel';
import { GameplayEntityPresenter } from './gameplay-entity-presenter';
import { projectGameplayUi, type GameplayUiProjection } from './ui/gameplay-ui-projector';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { GameplayPresentationEvent } from '../client/audio/gameplay-audio-events';
import { VoxelBreakOverlay } from './voxel-break-overlay';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
} from '../worker/authority-worker-protocol';
import { PLAYER_FEET_OFFSET } from './player-view-offsets';

export type BrowserGameplayAuthorityPort = Readonly<{
  gameplay: AuthorityGameplayView;
  performAction(action: AuthorityAction): Promise<AuthorityActionResult>;
}>;

type Options = {
  app: pc.Application;
  camera: pc.Entity;
  authority: BrowserGameplayAuthorityPort;
  playerId: string;
  bridge: UiBridge;
  session: UiWorldSession;
  nextHudSequence: () => number;
  nextInteractionSequence: () => number;
  getVoxel: (x: number, y: number, z: number) => number;
  queueSave: () => void;
  releaseInput: () => void;
  movePlayer: (position: [number, number, number]) => void | Promise<void>;
  onPresentation?: (event: GameplayPresentationEvent) => void;
};

export class BrowserGameplay {
  private readonly presenter: GameplayEntityPresenter;
  private readonly viewmodel: FirstPersonViewmodel;
  private readonly outline: VoxelTargetOutline;
  private readonly breakOverlay: VoxelBreakOverlay;
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
    this.breakOverlay = new VoxelBreakOverlay(options.app);
  }

  setSuspended(suspended: boolean): void {
    this.viewmodel.setVisible(!suspended && !this.blocksInput);
  }

  setAimTarget(target: VoxelTarget | null): void {
    this.aimTarget = target?.inRange ? target : null;
  }

  advance(seconds: number): void {
    this.breakProjectionElapsedSeconds += seconds;
    this.outline.update(this.blocksInput ? null : this.aimTarget);
    this.gestureSeconds = Math.max(0, this.gestureSeconds - seconds);
    const state = this.options.authority.gameplay.player;
    this.viewmodel.setHeldItem(state.inventory[state.selectedSlot]?.itemId ?? null);
    this.viewmodel.setVisible(!this.blocksInput);
    if (!this.gestureSeconds) this.viewmodel.setAction(state.breakAction ? 'mine' : 'idle');
    this.viewmodel.update(seconds);
    this.refresh(false);
  }

  refresh(forceBreakProjection = true): void {
    const view = this.options.authority.gameplay;
    const player = view.player;
    const becameDead = player.lifecycle === 'dead' && this.previousProjection?.shell.gameplay.lifecycle !== 'dead';
    if (becameDead) this.inventoryOpen = false;
    const entities = view.entities.filter((entity) => entity.type !== 'player');
    const actorStates = new Map(view.actors.map((actor) => [actor.entityId, actor] as const));
    this.presenter.reconcile(entities, view.gameplayTime);
    if (this.previousHealth !== null && player.health < this.previousHealth) this.present({ kind: 'damage' });
    this.previousHealth = player.health;
    const currentBreaking = player.breakAction
      ? {
          progress: Math.min(1, player.breakAction.elapsedSeconds / player.breakAction.requiredSeconds),
          label: voxelNames[player.breakAction.voxel] ?? '体素',
        }
      : null;
    this.breakOverlay.update(
      player.breakAction ? player.breakAction.position : null,
      player.breakAction ? player.breakAction.elapsedSeconds / player.breakAction.requiredSeconds : null,
    );
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
        revision: view.gameplayRevision,
        player: {
          lifecycle: player.lifecycle,
          health: player.health,
          hunger: player.hunger,
          selectedHotbarSlot: player.selectedSlot,
          inventory: player.inventory,
        },
        inventoryOpen: this.inventoryOpen,
        craftableRecipeIds: view.craftableRecipeIds,
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
    void this.action({ type: 'select-hotbar', slot }, (result) => {
      if (!result.success) this.feedback('快捷栏槽位无效', 'error');
    });
  }

  toggleInventory(): void {
    if (this.options.authority.gameplay.player.lifecycle === 'dead') return;
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
    void this.action({ type: 'craft', recipeId }, (result) => {
      this.feedback(result.success ? '合成完成' : `合成失败 · ${result.reason}`, result.success ? 'success' : 'error');
      if (result.success) {
        this.options.queueSave();
        this.present({ kind: 'craft' });
      }
    });
  }

  attackTarget(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    maxDistance: number,
  ): boolean {
    const target = this.options.authority.gameplay.entities
      .filter((entity) => entity.type === 'creature' || entity.type === 'npc')
      .map((entity) => ({
        entity,
        distance: entityHitDistance(entity.position, entity.archetype, origin, direction, maxDistance),
      }))
      .filter((hit): hit is typeof hit & { distance: number } => hit.distance !== null)
      .sort((left, right) => left.distance - right.distance)[0]?.entity;
    if (!target) return false;
    void this.action({ type: 'attack', targetId: target.id }, (result) => {
      this.feedback(result.success ? '攻击命中' : `攻击失败 · ${result.reason}`, result.success ? 'success' : 'error');
      if (result.success) this.present({ kind: 'attack', position: target.position });
      if (result.success) this.options.queueSave();
    });
    return true;
  }

  beginBreak(position: [number, number, number]): void {
    if (position[1] <= BROWSER_MIN_BUILD_Y) return this.feedback('已到达浏览器世界底层；保留基底石层', 'error');
    if (position[1] > BROWSER_MAX_BUILD_Y) return this.feedback(`采集高度限 1–${BROWSER_MAX_BUILD_Y} 层`, 'error');
    void this.action({ type: 'begin-break', position }, (result) => {
      if (!result.success) this.feedback(`无法采集 · ${result.reason}`, 'error');
    });
  }

  cancelBreak(): void {
    void this.action({ type: 'cancel-break' });
  }

  place(position: [number, number, number]): void {
    if (position[1] < BROWSER_MIN_BUILD_Y || position[1] > BROWSER_MAX_BUILD_Y)
      return this.feedback(`建造高度限 ${BROWSER_MIN_BUILD_Y}–${BROWSER_MAX_BUILD_Y} 层；物品已保留`, 'error');
    void this.action({ type: 'place', position }, (result) => {
      if (!result.success) return this.feedback(`无法放置 · ${result.reason}`, 'error');
      this.options.queueSave();
      this.feedback('放置 · 方块', 'success');
      this.present({ kind: 'place', voxel: this.options.getVoxel(...position), position });
    });
  }

  respawn(): void {
    void this.action({ type: 'respawn' }, (result) => {
      if (!result.success) return;
      const entity = this.options.authority.gameplay.entities.find(
        (candidate) => candidate.id === this.options.playerId,
      );
      if (entity)
        void this.options.movePlayer([entity.position[0], entity.position[1] + PLAYER_FEET_OFFSET, entity.position[2]]);
      this.options.queueSave();
    });
  }

  moveInventorySlot(source: number, target: number): void {
    void this.action({ type: 'move-inventory', source, target }, (result) => {
      this.feedback(
        result.success ? '物品已移动' : '无法移动：请检查目标槽位是否已满',
        result.success ? 'success' : 'error',
      );
      if (result.success) this.options.queueSave();
    });
  }

  useInventoryItem(slot: number): void {
    void this.action({ type: 'use-inventory', slot }, (result) => {
      const reason = !result.success && result.reason === 'hunger-full' ? '你现在不饿' : '这个物品暂时无法使用';
      this.feedback(result.success ? '食用 · 恢复饥饿' : reason, result.success ? 'success' : 'error');
      if (result.success) {
        this.present({ kind: 'eat' });
        this.options.queueSave();
      }
    });
  }

  useHeldItem(): boolean {
    const player = this.options.authority.gameplay.player;
    const stack = player.inventory[player.selectedSlot];
    if (!stack || getItemDefinition(stack.itemId).itemType !== 'food') return false;
    this.useInventoryItem(player.selectedSlot);
    return true;
  }

  get blocksInput(): boolean {
    return this.inventoryOpen || this.options.authority.gameplay.player.lifecycle === 'dead';
  }

  get presentedEntityCount(): number {
    return this.options.authority.gameplay.entities.filter((entity) => entity.type !== 'player').length;
  }

  get presentationSnapshot() {
    return { breakingOverlay: this.breakOverlay.snapshot, viewmodel: this.viewmodel.snapshot } as const;
  }

  dispose(): void {
    this.presenter.dispose();
    this.breakOverlay.destroy();
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

  private async action(
    action: AuthorityAction,
    consume: (result: { success: boolean; reason?: string }) => void = () => undefined,
  ): Promise<void> {
    try {
      const response = await this.options.authority.performAction(action);
      consume(response.result as { success: boolean; reason?: string });
      this.refresh();
    } catch (error) {
      this.feedback(error instanceof Error ? error.message : String(error), 'error');
    }
  }
}
