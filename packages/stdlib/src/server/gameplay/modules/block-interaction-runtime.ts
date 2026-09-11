import { Voxel } from '../../../world/voxel';
import type { WorldCommitResult } from '../../game-server-types';
import type { EntityStore, GameplayEntity } from '../entity-store';
import type { PreparedWorldEdit } from '../../prepared-world-edit';
import type { ActorComponentSnapshot } from '../ecs-actor-components';
import { prepareEntityMutation, type PreparedWorldItemSpawn } from '../prepared-entity-mutation';
import { Inventory } from '../inventory';
import { clonePosition, positionsInRange, voxelCenter } from '../gameplay-geometry';
import type { ItemDefinitionRegistry } from '../item-registry';
import { playerOccupiesVoxelShape } from '../player-occupancy';
import type { PlayerState } from '../player-state';
import type { VoxelGameplayRegistry } from '../voxel-gameplay';

type Position = [number, number, number];
type Failure = { success: false; reason: string };
type Result<Data extends object = Record<never, never>> = ({ success: true } & Data) | Failure;

export type BlockInteractionRuntimeOptions = Readonly<{
  player: (id: string) => PlayerState;
  entity: (id: string) => GameplayEntity | null;
  getVoxel: (position: Position) => number | undefined;
  prepareVoxelEdit: (actorId: string, position: Position, voxel: number) => PreparedWorldEdit;
  entities: EntityStore;
  assertCanChange(): void;
  items: ItemDefinitionRegistry;
  voxelGameplay: VoxelGameplayRegistry;
  changed: (inventoryOperation: boolean) => void;
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
    const definition = this.options.voxelGameplay.require(voxel);
    if (definition.hardnessSeconds === null) return { success: false, reason: 'unbreakable' };
    if (player.mode === 'creative') {
      const world = this.options.prepareVoxelEdit(id, position, Voxel.Air);
      if (!world.committed) return { success: false, reason: 'world-not-changed' };
      const components = this.options.entities.actorComponentSnapshot(id);
      const commit = this.commit(id, world, { ...components, player: { ...components.player!, breakAction: null } });
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
    if (!this.options.voxelGameplay.require(currentVoxel).replaceable)
      return { success: false, reason: 'target-occupied' };
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
    const world = this.options.prepareVoxelEdit(id, position, place.voxel);
    if (!world.committed) return { success: false, reason: 'world-not-changed' };
    const components = this.options.entities.actorComponentSnapshot(id);
    const inventory = new Inventory(player.inventory.capacity, components.inventory, this.options.items);
    if (!creative) inventory.removeFromSlot(player.selectedSlot, 1);
    const commit = this.commit(id, world, { ...components, inventory: inventory.snapshot() });
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
    const elapsedSeconds = action.elapsedSeconds + seconds;
    if (elapsedSeconds + Number.EPSILON < action.requiredSeconds) {
      player.breakAction = { ...action, elapsedSeconds };
      return;
    }
    const definition = this.options.voxelGameplay.require(action.voxel);
    const world = this.options.prepareVoxelEdit(id, action.position, Voxel.Air);
    if (!world.committed) return;
    const components = this.options.entities.actorComponentSnapshot(id);
    const spawns =
      player.mode !== 'creative' && definition.drop
        ? [{ position: voxelCenter(action.position), stack: { ...definition.drop } }]
        : [];
    const committed = this.commit(
      id,
      world,
      { ...components, player: { ...components.player!, breakAction: null } },
      spawns,
    );
    commits.push(committed);
    this.options.changed(false);
  }

  private commit(
    id: string,
    world: PreparedWorldEdit,
    components: ActorComponentSnapshot,
    spawns: readonly PreparedWorldItemSpawn[] = [],
  ): WorldCommitResult {
    this.options.assertCanChange();
    const entities = prepareEntityMutation(this.options.entities, {
      actors: [
        { reference: this.options.entities.createReference(id)!, health: this.options.entity(id)!.health!, components },
      ],
      spawns,
    });
    entities.validate();
    world.validate();
    entities.apply();
    return world.apply();
  }
}
