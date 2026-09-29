import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { GameplayCallbacks, GameplayResult } from './gameplay-runtime-contracts';
import type { PlayerState } from './player-state';
import { setSpawnFromBed } from './bed-action';
import { DifficultyRuntime, hostileActorsForPeaceful, type Difficulty } from './difficulty-runtime';
import { prepareArmorDamage, equipSelectedArmor } from './armor-equipment';
import type { ActorComponentAccess } from './ecs-actor-components';
import type { ArmorEquipment } from './ecs-actor-armor-state';
import type { ItemDefinitionRegistry } from './item-registry';

type Position = [number, number, number];

export const applyDifficultyDamage = (
  difficulty: DifficultyRuntime,
  simulation: AutonomyRuntime,
  actorId: string,
  amount: number,
  apply: (amount: number) => GameplayResult,
) => {
  const actor = simulation.getActor(actorId);
  const adjusted = actor?.disposition === 'hostile' ? difficulty.damage(amount) : amount;
  return adjusted === 0 ? { success: true as const } : apply(adjusted);
};

export const applySurvivalDamage = (
  difficulty: DifficultyRuntime,
  simulation: AutonomyRuntime,
  target: ActorComponentAccess,
  items: ItemDefinitionRegistry,
  actorId: string,
  amount: number,
  apply: (amount: number, armor?: ArmorEquipment) => GameplayResult,
) => {
  if (!Number.isFinite(amount) || amount <= 0 || target.mode !== 'survival') return apply(amount);
  return applyDifficultyDamage(difficulty, simulation, actorId, amount, (adjusted) => {
    const candidate = prepareArmorDamage(target, items, adjusted);
    return apply(candidate.damage, candidate.armor);
  });
};

export const equipArmor = (actor: ActorComponentAccess, items: ItemDefinitionRegistry, changed: () => void) => {
  const result = equipSelectedArmor(actor, items);
  if (result.success) changed();
  return result;
};

export const changeDifficulty = (
  difficulty: DifficultyRuntime,
  simulation: AutonomyRuntime,
  value: Difficulty,
  expectedRevision: number | undefined,
  despawn: (id: string) => void,
  changed: () => void,
) => {
  const result = difficulty.set(value, expectedRevision);
  if (!result.success || !result.changed) return result;
  if (value === 'peaceful')
    hostileActorsForPeaceful(
      simulation.queryActors().map((actor) => ({ id: actor.entityId, disposition: actor.disposition })),
    ).forEach(despawn);
  changed();
  return result;
};

export const useSelectedBed = (
  player: PlayerState,
  bedPosition: Position,
  callbacks: Pick<GameplayCallbacks, 'getVoxel'>,
  changed: () => void,
) => {
  if (player.inventory.slot(player.selectedSlot)?.itemId !== 'bed')
    return { success: false as const, reason: 'bed-not-selected' };
  const result = setSpawnFromBed(player, bedPosition, (position) => {
    const candidate: Position = [position[0] + 0.5, position[1] + 1, position[2] + 0.5];
    return callbacks.getVoxel(candidate) === 0 ? candidate : null;
  });
  if (result.success) changed();
  return result;
};
