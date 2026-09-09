import { FirstPersonViewmodel } from '../player/first-person-viewmodel';
import { VoxelTargetOutline } from './voxel-target-outline';
import type { VoxelTarget } from '../../client/presentation/voxel-target';
import { BROWSER_MIN_BUILD_Y, BROWSER_MAX_BUILD_Y } from '../world/browser-world-limits';
import { entityHitDistance } from '../../client/presentation/entity-hit-volume';
import type * as pc from 'playcanvas';
import { getItemDefinition } from '@seedlands/game-core/server/gameplay/item-registry';
import { voxelNames } from '@seedlands/game-core/world/voxel';
import { GameplayEntityPresenter } from './gameplay-entity-presenter';
import { projectGameplayUi, type GameplayUiProjection } from '../ui/gameplay-ui-projector';
import type { UiBridge, UiWorldSession } from '../ui/ui-bridge';
import type { GameplayPresentationEvent } from '../../client/audio/gameplay-audio-events';
import { VoxelBreakOverlay } from './voxel-break-overlay';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
} from '@seedlands/game-core/compute/authority-worker-protocol';
import { PLAYER_FEET_OFFSET } from '../player/player-view-offsets';
import type { CommandResult, ServerCommand } from '@seedlands/game-core/server/commands/command-contract';
import { createMeleeShowcaseIds, meleeShowcaseCommands, MELEE_SHOWCASE_PLAYER_CAMERA } from './melee-action-showcase';
import { executeBrowserModeCommand, type BrowserModeCommandExecutor } from './browser-gameplay-actions';
import type { ModeCommand } from '@seedlands/game-core/server/commands/module-command';
import type { ActorMode } from '../ui/ui-contracts';

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
  orientPlayer: (yaw: number, pitch: number) => void;
  executeCommand: (command: ServerCommand) => Promise<CommandResult>;
  executeModeCommand: BrowserModeCommandExecutor;
  onPlayerDamage?: (amount: number) => void;
  onPresentation?: (event: GameplayPresentationEvent) => void;
};

export class BrowserGameplay {
  private showcasePreparation: Promise<void> | null = null;
  private readonly presenter: GameplayEntityPresenter;
  private readonly viewmodel: FirstPersonViewmodel;
  private readonly outline: VoxelTargetOutline;
  private readonly breakOverlay: VoxelBreakOverlay;
  private aimTarget: VoxelTarget | null = null;
  private gestureSeconds = 0;
  private inventoryOpen = false;
  private previousProjection: GameplayUiProjection | undefined;
  private previousHealth: number | null = null;
  private lastCombatResultSequence: number | null = null;
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

  prepareMeleeShowcase(): Promise<void> {
    return (this.showcasePreparation ??= this.prepareMeleeShowcaseInstance()
      .catch((error: unknown) => {
        this.feedback(error instanceof Error ? error.message : String(error), 'error');
        throw error;
      })
      .finally(() => {
        this.showcasePreparation = null;
      }));
  }

  private async prepareMeleeShowcaseInstance(): Promise<void> {
    const authority = this.options.authority;
    if (authority.gameplay.player.lifecycle === 'dead') await this.executeShowcaseCommand({ type: 'respawn' });
    const existingIds = new Set(authority.gameplay.entities.map((entity) => entity.id));
    for (const command of meleeShowcaseCommands(existingIds, createMeleeShowcaseIds(crypto.randomUUID())))
      await this.executeShowcaseCommand(command);

    let swordSlot = authority.gameplay.player.inventory.findIndex((slot) => slot?.itemId === 'wood-sword');
    if (swordSlot < 0) {
      await this.executeShowcaseCommand({ type: 'give-item', itemId: 'wood-sword', count: 1 });
      swordSlot = authority.gameplay.player.inventory.findIndex((slot) => slot?.itemId === 'wood-sword');
    }
    if (swordSlot < 0) throw new Error('体验场无法把木剑放入背包。');
    if (swordSlot >= authority.gameplay.player.hotbarSize) {
      const empty = authority.gameplay.player.inventory
        .slice(0, authority.gameplay.player.hotbarSize)
        .findIndex((slot) => slot === null);
      const target = empty >= 0 ? empty : 0;
      const moved = await authority.performAction({ type: 'move-inventory', source: swordSlot, target });
      if (!(moved.result as { success?: boolean }).success) throw new Error('体验场无法把木剑移动到快捷栏。');
      swordSlot = target;
    }
    const selected = await authority.performAction({ type: 'select-hotbar', slot: swordSlot });
    if (!(selected.result as { success?: boolean }).success) throw new Error('体验场无法装备木剑。');
    await this.options.movePlayer([...MELEE_SHOWCASE_PLAYER_CAMERA]);
    this.options.orientPlayer(0, -15);
    this.refresh();
    this.options.bridge.publishShell({ experience: 'melee-showcase' });
    this.options.session.publishFeedback(this.options.nextInteractionSequence(), {
      message: '体验场已布置：准星已对准中央训练目标，按住左键观察两段反向挥砍。',
      tone: 'info',
      durationMs: 4_000,
    });
    this.options.queueSave();
  }

  async triggerMeleeShowcaseDamage(): Promise<void> {
    const player = this.options.authority.gameplay.player;
    if (player.lifecycle === 'dead') await this.executeShowcaseCommand({ type: 'respawn' });
    else if (player.health <= 2) await this.executeShowcaseCommand({ type: 'heal', amount: 20 });
    await this.executeShowcaseCommand({ type: 'apply-damage', amount: 2 });
  }

  advance(seconds: number): void {
    this.breakProjectionElapsedSeconds += seconds;
    this.outline.update(this.blocksInput ? null : this.aimTarget);
    this.gestureSeconds = Math.max(0, this.gestureSeconds - seconds);
    const state = this.options.authority.gameplay.player;
    const heldItem =
      state.mode?.value === 'creative'
        ? (state.creativeCatalog?.hotbar[state.creativeCatalog.selectedSlot] ?? null)
        : (state.inventory[state.selectedSlot]?.itemId ?? null);
    this.viewmodel.setHeldItem(heldItem);
    this.viewmodel.setCombatAction(state.combat?.active ?? null);
    this.viewmodel.setVisible(!this.blocksInput);
    if (!this.gestureSeconds) this.viewmodel.setAction(state.breakAction ? 'mine' : 'idle');
    this.viewmodel.update(seconds);
    this.refresh(false, seconds);
  }

  private async executeShowcaseCommand(command: ServerCommand): Promise<void> {
    const result = await this.options.executeCommand(command);
    if (!result.success) throw new Error(`体验场布置失败：${result.error.message}`);
  }

  refresh(forceBreakProjection = true, renderDeltaSeconds = 0): void {
    const view = this.options.authority.gameplay;
    const player = view.player;
    this.consumeCombatResult();
    const becameDead = player.lifecycle === 'dead' && this.previousProjection?.shell.gameplay.lifecycle !== 'dead';
    if (becameDead) this.inventoryOpen = false;
    const entities = view.entities.filter((entity) => entity.type !== 'player');
    const actorStates = new Map(view.actors.map((actor) => [actor.entityId, actor] as const));
    this.presenter.reconcile(entities, renderDeltaSeconds);
    if (this.previousHealth !== null && player.health < this.previousHealth) {
      const amount = this.previousHealth - player.health;
      this.options.onPlayerDamage?.(amount);
      this.present({ kind: 'damage', amount });
    }
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
          combat: player.combat,
          lifecycle: player.lifecycle,
          health: player.health,
          hunger: player.hunger,
          selectedHotbarSlot: player.selectedSlot,
          inventory: player.inventory,
          mode: player.mode,
          creativeCatalog: player.creativeCatalog,
          flight: player.flight,
        },
        items: view.items,
        recipes: view.recipes,
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
            ? `${this.itemDefinition(entity.stack.itemId)?.name ?? entity.stack.itemId}掉落物`
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
    const player = this.options.authority.gameplay.player;
    if (player.mode?.value === 'creative') {
      this.setCreativeSlot(slot, player.creativeCatalog?.hotbar[slot] ?? null);
      return;
    }
    void this.action({ type: 'select-hotbar', slot }, (result) => {
      if (!result.success) this.feedback('快捷栏槽位无效', 'error');
    });
  }

  setActorMode(mode: ActorMode): void {
    void this.runModeCommand(
      { type: 'set-mode', mode },
      mode === 'creative' ? '已切换创造模式 · 飞行已开启' : '已安全落地并切换生存模式',
    );
  }

  setFlight(enabled: boolean): void {
    void this.runModeCommand(
      { type: 'set-flight', enabled },
      enabled ? '飞行已开启 · Space 上升，Shift 下降' : '飞行已关闭',
    );
  }

  setCreativeSlot(slot: number, itemId: string | null): void {
    void this.runModeCommand(
      { type: 'set-creative-slot', slot, itemId },
      itemId ? `创造快捷栏 ${slot + 1} 已更新` : `创造快捷栏 ${slot + 1} 已清空`,
    );
  }

  executeUiModeCommand(command: ModeCommand): void {
    if (command.type === 'set-mode') this.setActorMode(command.mode);
    else if (command.type === 'set-flight') this.setFlight(command.enabled);
    else this.setCreativeSlot(command.slot, command.itemId);
  }

  async applyInitialActorMode(mode: ActorMode): Promise<void> {
    if (mode === 'survival') return;
    await this.runModeCommand({ type: 'set-mode', mode }, '', true);
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
      if (!result.success) {
        if (result.reason === 'cooldown' || result.reason === 'attack-cooldown' || result.reason === 'buffer-full')
          return;
        if (result.reason === 'combo-window-closed') return this.feedback('等待衔接窗口', 'info');
        const reason =
          result.reason === 'out-of-range'
            ? '目标超出攻击距离'
            : result.reason === 'blocked'
              ? '目标被方块遮挡'
              : result.reason === 'invalid-target'
                ? '目标已离开或倒下'
                : '当前无法攻击';
        this.feedback(reason, 'error');
      } else if (result.buffered) this.feedback('已衔接下一击', 'info');
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
    if (player.mode?.value === 'creative') return false;
    const stack = player.inventory[player.selectedSlot];
    if (!stack || !this.itemDefinition(stack.itemId)?.capabilities.some((capability) => capability.type === 'consume'))
      return false;
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

  presentedEntityPosition(id: string): [number, number, number] | null {
    return this.presenter.presentedPosition(id);
  }

  dispose(): void {
    this.presenter.dispose();
    this.breakOverlay.destroy();
    this.viewmodel.dispose();
  }

  private consumeCombatResult(): void {
    const result = this.options.authority.gameplay.player.combat?.lastResult;
    const sequence = result?.sequence ?? 0;
    if (this.lastCombatResultSequence === null) {
      this.lastCombatResultSequence = sequence;
      return;
    }
    if (!result || sequence <= this.lastCombatResultSequence) return;
    this.lastCombatResultSequence = sequence;
    if (result.outcome === 'hit') {
      this.feedback(`命中 · ${result.damage} 点伤害`, 'success');
      this.present({ kind: 'attack' });
      this.options.queueSave();
    } else if (result.outcome === 'miss') this.feedback('挥空 · 目标离开范围或被遮挡', 'info');
    else this.feedback('攻击已取消', 'info');
  }

  private itemDefinition(itemId: string) {
    const definitions = this.options.authority.gameplay.items;
    return definitions ? definitions.find((definition) => definition.id === itemId) : getItemDefinition(itemId);
  }

  private present(event: GameplayPresentationEvent): void {
    this.options.onPresentation?.(event);
    const kind = event.kind;
    if (kind === 'attack' || kind === 'place' || kind === 'eat') {
      this.viewmodel.setAction(kind, true);
      this.gestureSeconds = 0.42;
    }
    if (kind === 'attack' || kind === 'place' || kind === 'eat' || kind === 'damage') {
      const sequence = this.options.nextInteractionSequence();
      this.options.session.publishInteraction(sequence, {
        gesture: { kind, sequence, ...(event.kind === 'damage' ? { amount: event.amount } : {}) },
      });
    }
  }

  private feedback(message: string, tone: 'info' | 'success' | 'error'): void {
    if (tone === 'error') this.present({ kind: 'rejected' });
    this.options.session.publishFeedback(this.options.nextInteractionSequence(), { message, tone, durationMs: 1_400 });
  }

  private async runModeCommand(command: ModeCommand, successMessage: string, propagate = false): Promise<void> {
    try {
      await executeBrowserModeCommand(this.options.executeModeCommand, this.options.playerId, command);
      this.refresh();
      this.options.queueSave();
      if (successMessage) this.feedback(successMessage, 'success');
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = /safe landing/i.test(raw) ? '无法切回生存：当前位置没有安全落脚点。' : raw;
      if (propagate) throw new Error(message, { cause: error });
      this.feedback(message, 'error');
    }
  }

  private async action(
    action: AuthorityAction,
    consume: (result: { success: boolean; reason?: string; buffered?: boolean }) => void = () => undefined,
  ): Promise<void> {
    try {
      const response = await this.options.authority.performAction(action);
      consume(response.result as { success: boolean; reason?: string; buffered?: boolean });
      this.refresh();
    } catch (error) {
      this.feedback(error instanceof Error ? error.message : String(error), 'error');
    }
  }
}
