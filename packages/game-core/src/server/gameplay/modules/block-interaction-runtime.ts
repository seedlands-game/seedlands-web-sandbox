import { Voxel } from '../../../world/voxel';
import type { WorldCommitResult } from '../../game-server-types';
import type { GameplayEntity } from '../entity-store';
import { clonePosition, positionsInRange, voxelCenter } from '../gameplay-geometry';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { playerOccupiesVoxelShape } from '../player-occupancy';
import type { PlayerState } from '../player-state';
import { getVoxelGameplayDefinition } from '../voxel-gameplay';

type Position = [number, number, number];
type Failure = { success: false; reason: string };
type Result<Data extends object = Record<never, never>> = ({ success: true } & Data) | Failure;

export type BlockInteractionRuntimeOptions = Readonly<{
  player: (id: string) => PlayerState;
  entity: (id: string) => GameplayEntity | null;
  getVoxel: (position: Position) => number | undefined;
  editVoxel: (actorId: string, position: Position, voxel: number) => WorldCommitResult;
  items: ItemDefinitionRegistry;
  changed: (inventoryOperation: boolean) => void;
  spawnDrop: (position: Position, stack: ItemStack) => void;
}>;

export class BlockInteractionRuntime {
  constructor(private readonly options: BlockInteractionRuntimeOptions) {}

  beginBreak(id: string, position: Position): Result<{ requiredSeconds: number; commit?: WorldCommitResult }> {
    const player = this.options.player(id);
    if (player.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const entity = this.options.entity(id)!;
    if (!positionsInRange(entity.position, voxelCenter(position), 5)) return { success: false, reason: 'out-of-range' };
    const voxel = this.options.getVoxel(position);
    if (voxel === undefined) return { success: false, reason: 'chunk-unavailable' };
    const definition = getVoxelGameplayDefinition(voxel);
    if (definition.hardnessSeconds === null) return { success: false, reason: 'unbreakable' };
    if (player.mode === 'creative') {
      const commit = this.options.editVoxel(id, position, Voxel.Air);
      if (!commit.committed) return { success: false, reason: 'world-not-changed' };
      player.breakAction = null;
      this.options.changed(false);
      return { success: true, requiredSeconds: 0, commit };
    }
    const selected = player.inventory.slot(player.selectedSlot);
    const mine = selected ? this.options.items.capability(selected.itemId, 'mine') : undefined;
    const multiplier = mine?.tool === definition.preferredTool ? mine.multiplier : 1;
    const requiredSeconds = Number((definition.hardnessSeconds / multiplier).toFixed(6));
    const current = player.breakAction;
    player.breakAction =
      current && current.voxel === voxel && current.position.every((value, index) => value === position[index])
        ? current
        : { position: clonePosition(position), voxel, elapsedSeconds: 0, requiredSeconds };
    this.options.changed(false);
    return { success: true, requiredSeconds };
  }

  cancelBreak(id: string): Result {
    const player = this.options.player(id);
    if (!player.breakAction) return { success: true };
    player.breakAction = null;
    this.options.changed(false);
    return { success: true };
  }

  placeVoxel(id: string, position: Position): Result<{ commit: WorldCommitResult }> {
    const player = this.options.player(id);
    if (player.lifecycle !== 'alive') return { success: false, reason: 'player-dead' };
    const entity = this.options.entity(id)!;
    if (!positionsInRange(entity.position, voxelCenter(position), 5)) return { success: false, reason: 'out-of-range' };
    const currentVoxel = this.options.getVoxel(position);
    if (currentVoxel === undefined) return { success: false, reason: 'chunk-unavailable' };
    if (!getVoxelGameplayDefinition(currentVoxel).replaceable) return { success: false, reason: 'target-occupied' };
    const creative = player.mode === 'creative';
    const survivalStack = player.inventory.slot(player.selectedSlot);
    const selectedItemId = creative
      ? player.creativeCatalog.hotbar[player.creativeCatalog.selectedSlot]
      : survivalStack?.itemId;
    if (!selectedItemId) return { success: false, reason: 'no-selected-item' };
    const place = this.options.items.capability(selectedItemId, 'place');
    if (!place) return { success: false, reason: 'item-not-placeable' };
    if (playerOccupiesVoxelShape(entity.position, position, place.voxel))
      return { success: false, reason: 'player-collision' };
    const commit = this.options.editVoxel(id, position, place.voxel);
    if (!commit.committed) return { success: false, reason: 'world-not-changed' };
    if (!creative) player.inventory.removeFromSlot(player.selectedSlot, 1);
    this.options.changed(!creative);
    return { success: true, commit };
  }

  advanceBreak(id: string, seconds: number, commits: WorldCommitResult[]): void {
    const player = this.options.player(id);
    const action = player.breakAction;
    if (!action) return;
    const entity = this.options.entity(id)!;
    const currentVoxel = this.options.getVoxel(action.position);
    if (currentVoxel === undefined) return;
    if (currentVoxel !== action.voxel || !positionsInRange(entity.position, voxelCenter(action.position), 5)) {
      player.breakAction = null;
      return;
    }
    action.elapsedSeconds += seconds;
    player.breakAction = action;
    if (action.elapsedSeconds + Number.EPSILON < action.requiredSeconds) return;
    player.breakAction = null;
    const definition = getVoxelGameplayDefinition(action.voxel);
    const commit = this.options.editVoxel(id, action.position, Voxel.Air);
    if (!commit.committed) return;
    commits.push(commit);
    if (player.mode !== 'creative' && definition.drop)
      this.options.spawnDrop(voxelCenter(action.position), { ...definition.drop });
  }
}
