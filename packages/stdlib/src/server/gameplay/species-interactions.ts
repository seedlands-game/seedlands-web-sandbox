import { Inventory } from './inventory';
import type { EntityStore } from './entity-store';
import { defaultSpeciesState } from './species-state';

type Context = Readonly<{ entities: EntityStore; changed(): void }>;
const inRange = (left: readonly number[], right: readonly number[]) =>
  Math.hypot(...left.map((v, i) => v - right[i])) <= 5;
const selected = (context: Context, playerId: string) => {
  const player = context.entities.get(playerId);
  if (!player || player.type !== 'player') return null;
  const state = context.entities.actorStateAccess(playerId);
  return { player, state, stack: state.inventory.slot(state.selectedSlot) };
};
const commit = (
  context: Context,
  playerId: string,
  inventory: Inventory,
  targetId: string,
  species: NonNullable<ReturnType<typeof defaultSpeciesState>>,
) => {
  const player = context.entities.get(playerId)!,
    target = context.entities.get(targetId)!;
  const playerState = context.entities.actorComponentSnapshot(playerId);
  const targetState = context.entities.actorComponentSnapshot(targetId);
  const prepared = context.entities.prepareMutation({
    actors: [
      {
        reference: context.entities.createReference(playerId)!,
        health: player.health!,
        components: { ...playerState, inventory: inventory.snapshot() },
      },
      {
        reference: context.entities.createReference(targetId)!,
        health: target.health!,
        components: { ...targetState, species },
      },
    ],
  });
  prepared.validate();
  prepared.apply();
  context.changed();
};

export function shearSheep(context: Context, playerId: string, sheepId: string) {
  const actor = selected(context, playerId),
    sheep = context.entities.get(sheepId);
  const current = sheep?.archetype === 'sheep' ? context.entities.actorStateAccess(sheepId).species : null;
  if (!actor || !sheep || !current || !inRange(actor.player.position, sheep.position))
    return { success: false as const, reason: 'invalid-target' };
  if (current.sheared) return { success: false as const, reason: 'already-sheared' };
  if (actor.stack?.itemId !== 'shears' || !actor.stack.instance)
    return { success: false as const, reason: 'requires-shears' };
  const inventory = new Inventory(
    actor.state.inventory.capacity,
    actor.state.inventory.snapshot(),
    actor.state.inventory.items,
  );
  const next = inventory.snapshot(),
    held = next[actor.state.selectedSlot]!;
  next[actor.state.selectedSlot] =
    held.instance!.durability === 1 ? null : { ...held, instance: { durability: held.instance!.durability - 1 } };
  inventory.replace(next);
  if (!inventory.add({ itemId: 'wool', count: 2 })) return { success: false as const, reason: 'inventory-full' };
  commit(context, playerId, inventory, sheepId, { ...current, sheared: true });
  return { success: true as const, count: 2, color: current.woolColor };
}

export function tameWolf(context: Context, playerId: string, wolfId: string) {
  const actor = selected(context, playerId),
    wolf = context.entities.get(wolfId);
  const current = wolf?.archetype === 'wolf' ? context.entities.actorStateAccess(wolfId).species : null;
  if (!actor || !wolf || !current || !inRange(actor.player.position, wolf.position))
    return { success: false as const, reason: 'invalid-target' };
  if (current.tamedBy) return { success: false as const, reason: 'already-tamed' };
  if (actor.stack?.itemId !== 'bone') return { success: false as const, reason: 'requires-bone' };
  const inventory = new Inventory(
    actor.state.inventory.capacity,
    actor.state.inventory.snapshot(),
    actor.state.inventory.items,
  );
  inventory.removeFromSlot(actor.state.selectedSlot, 1);
  const attempt = current.tameAttempts + 1;
  const success = (Math.imul(playerId.length ^ wolfId.length, 31) + attempt) % 3 === 0;
  commit(context, playerId, inventory, wolfId, {
    ...current,
    tameAttempts: attempt,
    tamedBy: success ? playerId : null,
  });
  return { success: true as const, tamed: success };
}

export function toggleWolfSitting(context: Context, playerId: string, wolfId: string) {
  const actor = selected(context, playerId),
    wolf = context.entities.get(wolfId);
  const current = wolf?.archetype === 'wolf' ? context.entities.actorStateAccess(wolfId).species : null;
  if (!actor || !wolf || !current || current.tamedBy !== playerId || !inRange(actor.player.position, wolf.position))
    return { success: false as const, reason: 'not-owner' };
  const inventory = new Inventory(
    actor.state.inventory.capacity,
    actor.state.inventory.snapshot(),
    actor.state.inventory.items,
  );
  commit(context, playerId, inventory, wolfId, { ...current, sitting: !current.sitting });
  return { success: true as const, sitting: !current.sitting };
}
