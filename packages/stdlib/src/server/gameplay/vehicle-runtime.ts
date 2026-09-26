import { Voxel } from '../../world/voxel';
import type { EntityStore } from './entity-store';
import type { ItemStack } from './item-registry';
import { resolveRailShape } from './rail-runtime';

export type VehicleKind = 'minecart' | 'chest-minecart' | 'furnace-minecart' | 'boat' | 'pig';
export type VehicleState = Readonly<{
  id: string;
  kind: VehicleKind;
  position: readonly [number, number, number];
  velocity: number;
  heading: readonly [number, number];
  riderId: string | null;
  fuelSeconds: number;
  inventory: readonly (Readonly<{ itemId: string; count: number }> | null)[];
}>;
export type VehicleCheckpoint = Readonly<{ version: 1; sequence: number; vehicles: readonly VehicleState[] }>;
type Context = Readonly<{
  entities: EntityStore;
  getLoadedVoxel?(position: [number, number, number]): number | undefined;
  changed(): void;
}>;
const kinds: readonly VehicleKind[] = ['minecart', 'chest-minecart', 'furnace-minecart', 'boat', 'pig'];
const copyPosition = (value: readonly number[]): readonly [number, number, number] => {
  if (value.length !== 3 || !value.every(Number.isFinite)) throw new TypeError('Vehicle position is invalid.');
  return Object.freeze([value[0], value[1], value[2]]);
};

export function validateVehicleCheckpoint(
  value: VehicleCheckpoint = { version: 1, sequence: 0, vehicles: [] },
): VehicleCheckpoint {
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !Array.isArray(value.vehicles)
  )
    throw new TypeError('Vehicle checkpoint is invalid.');
  const ids = new Set<string>();
  const vehicles = value.vehicles.map((entry) => {
    if (
      !entry.id?.trim() ||
      ids.has(entry.id) ||
      !kinds.includes(entry.kind) ||
      !Number.isFinite(entry.velocity) ||
      !Number.isFinite(entry.fuelSeconds) ||
      entry.fuelSeconds < 0 ||
      entry.heading.length !== 2 ||
      !entry.heading.every(Number.isFinite) ||
      !Array.isArray(entry.inventory) ||
      entry.inventory.length !== (entry.kind === 'chest-minecart' ? 27 : 0)
    )
      throw new TypeError('Vehicle state is invalid.');
    ids.add(entry.id);
    if (entry.riderId !== null && (typeof entry.riderId !== 'string' || !entry.riderId.trim()))
      throw new TypeError('Vehicle rider is invalid.');
    return Object.freeze({
      ...entry,
      position: copyPosition(entry.position),
      heading: Object.freeze([entry.heading[0], entry.heading[1]] as const),
      inventory: Object.freeze(
        entry.inventory.map((slot: Readonly<ItemStack> | null) => (slot ? Object.freeze({ ...slot }) : null)),
      ),
    });
  });
  return Object.freeze({ version: 1, sequence: value.sequence, vehicles: Object.freeze(vehicles) });
}

export class VehicleRuntime {
  #sequence = 0;
  readonly #vehicles = new Map<string, VehicleState>();
  constructor(
    private readonly context: Context,
    checkpoint?: VehicleCheckpoint,
  ) {
    this.restore(checkpoint);
  }
  spawn(kind: VehicleKind, at: [number, number, number]) {
    const valid =
      kind === 'pig'
        ? false
        : kind === 'boat'
          ? this.context.getLoadedVoxel?.(at) === Voxel.Water ||
            (this.context.getLoadedVoxel?.(at) === Voxel.Air &&
              this.context.getLoadedVoxel?.([at[0], at[1] - 1, at[2]]) === Voxel.Water)
          : resolveRailShape(at, this.context.getLoadedVoxel ?? (() => undefined)) !== null;
    if (!valid) return { success: false as const, reason: 'invalid-surface' };
    const state: VehicleState = Object.freeze({
      id: 'vehicle-' + ++this.#sequence,
      kind,
      position: copyPosition(at),
      velocity: 0,
      heading: Object.freeze([1, 0] as const),
      riderId: null,
      fuelSeconds: 0,
      inventory: Object.freeze(kind === 'chest-minecart' ? Array(27).fill(null) : []),
    });
    this.#vehicles.set(state.id, state);
    this.context.changed();
    return { success: true as const, vehicle: state };
  }
  deploy(playerId: string, kind: Exclude<VehicleKind, 'pig'>, at: [number, number, number]) {
    const player = this.context.entities.get(playerId);
    if (player?.type !== 'player') return { success: false as const, reason: 'invalid-player' };
    const actor = this.context.entities.actorStateAccess(playerId);
    if (actor.inventory.slot(actor.selectedSlot)?.itemId !== kind)
      return { success: false as const, reason: 'wrong-vehicle-item' };
    const result = this.spawn(kind, at);
    if (!result.success) return result;
    actor.inventory.removeFromSlot(actor.selectedSlot, 1);
    return result;
  }
  saddlePig(playerId: string, pigId: string) {
    const player = this.context.entities.get(playerId),
      pig = this.context.entities.get(pigId);
    const species = pig?.archetype === 'pig' ? this.context.entities.actorStateAccess(pigId).species : null;
    if (player?.type !== 'player' || !pig || !species || distance(player.position, pig.position) > 3)
      return { success: false as const, reason: 'invalid-pig' };
    const actor = this.context.entities.actorStateAccess(playerId);
    if (species.saddled || actor.inventory.slot(actor.selectedSlot)?.itemId !== 'saddle')
      return { success: false as const, reason: species.saddled ? 'already-saddled' : 'requires-saddle' };
    const inventory = actor.inventory.snapshot();
    const held = inventory[actor.selectedSlot]!;
    inventory[actor.selectedSlot] = held.count === 1 ? null : { ...held, count: held.count - 1 };
    const playerState = this.context.entities.actorComponentSnapshot(playerId);
    const pigState = this.context.entities.actorComponentSnapshot(pigId);
    const prepared = this.context.entities.prepareMutation({
      actors: [
        {
          reference: this.context.entities.createReference(playerId)!,
          health: player.health!,
          components: { ...playerState, inventory },
        },
        {
          reference: this.context.entities.createReference(pigId)!,
          health: pig.health!,
          components: { ...pigState, species: { ...species, saddled: true } },
        },
      ],
    });
    prepared.validate();
    prepared.apply();
    this.#vehicles.set(
      'pig:' + pigId,
      Object.freeze({
        id: 'pig:' + pigId,
        kind: 'pig',
        position: copyPosition(pig.position),
        velocity: 0,
        heading: Object.freeze([1, 0] as const),
        riderId: null,
        fuelSeconds: 0,
        inventory: Object.freeze([]),
      }),
    );
    this.context.changed();
    return { success: true as const, vehicleId: 'pig:' + pigId };
  }
  setMotion(id: string, velocity: number, heading: readonly [number, number]) {
    const vehicle = this.#vehicles.get(id);
    if (
      !vehicle ||
      !Number.isFinite(velocity) ||
      velocity < 0 ||
      !heading.every(Number.isFinite) ||
      Math.hypot(...heading) === 0
    )
      return { success: false as const, reason: 'invalid-motion' };
    const length = Math.hypot(...heading);
    this.#vehicles.set(
      id,
      Object.freeze({
        ...vehicle,
        velocity,
        heading: Object.freeze([heading[0] / length, heading[1] / length] as const),
      }),
    );
    this.context.changed();
    return { success: true as const };
  }
  fuel(id: string, seconds: number) {
    const vehicle = this.#vehicles.get(id);
    if (vehicle?.kind !== 'furnace-minecart' || !Number.isFinite(seconds) || seconds <= 0)
      return { success: false as const, reason: 'fuel-rejected' };
    this.#vehicles.set(id, Object.freeze({ ...vehicle, fuelSeconds: vehicle.fuelSeconds + seconds }));
    this.context.changed();
    return { success: true as const };
  }
  detectorActive(at: [number, number, number]) {
    return (
      this.context.getLoadedVoxel?.(at) === Voxel.DetectorRail &&
      [...this.#vehicles.values()].some((vehicle) => vehicle.kind !== 'boat' && distance(vehicle.position, at) < 0.75)
    );
  }
  mount(playerId: string, vehicleId: string) {
    const player = this.context.entities.get(playerId),
      vehicle = this.#vehicles.get(vehicleId);
    if (player?.type !== 'player' || !vehicle || vehicle.riderId || distance(player.position, vehicle.position) > 3)
      return { success: false as const, reason: 'mount-rejected' };
    this.#vehicles.set(vehicleId, Object.freeze({ ...vehicle, riderId: playerId }));
    this.context.entities.move(playerId, vehicle.position);
    this.context.changed();
    return { success: true as const };
  }
  dismount(playerId: string) {
    const vehicle = [...this.#vehicles.values()].find((entry) => entry.riderId === playerId);
    if (!vehicle) return { success: false as const, reason: 'not-riding' };
    const exits = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    const at = exits
      .map(
        ([x, z]) => [vehicle.position[0] + x, vehicle.position[1], vehicle.position[2] + z] as [number, number, number],
      )
      .find(
        (candidate) =>
          this.context.getLoadedVoxel?.(candidate) === Voxel.Air &&
          this.context.getLoadedVoxel?.([candidate[0], candidate[1] + 1, candidate[2]]) === Voxel.Air,
      );
    if (!at) return { success: false as const, reason: 'no-safe-exit' };
    this.#vehicles.set(vehicle.id, Object.freeze({ ...vehicle, riderId: null }));
    this.context.entities.move(playerId, at);
    this.context.changed();
    return { success: true as const, position: at };
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Vehicle advance is invalid.');
    for (const [id, vehicle] of this.#vehicles) {
      const voxel = this.context.getLoadedVoxel?.([...vehicle.position]);
      const shape =
        vehicle.kind === 'boat' || vehicle.kind === 'pig'
          ? null
          : resolveRailShape(vehicle.position, this.context.getLoadedVoxel ?? (() => undefined));
      if ((vehicle.kind === 'boat' && voxel !== Voxel.Water) || (!['boat', 'pig'].includes(vehicle.kind) && !shape))
        continue;
      const powered = voxel === Voxel.PoweredRail || (vehicle.kind === 'furnace-minecart' && vehicle.fuelSeconds > 0);
      const speed = Math.max(0, Math.min(8, vehicle.velocity + (powered ? 2 : -0.4) * seconds));
      const xAxis =
        vehicle.kind === 'pig' || shape === 'east-west' || shape?.includes('east') || shape?.includes('west');
      const rise = shape?.startsWith('ascending-') ? speed * seconds : 0;
      const next = copyPosition([
        vehicle.position[0] + (xAxis ? vehicle.heading[0] * speed * seconds : 0),
        vehicle.position[1] + rise,
        vehicle.position[2] + (!xAxis ? vehicle.heading[1] * speed * seconds : 0),
      ]);
      const state = Object.freeze({
        ...vehicle,
        position: next,
        velocity: speed,
        fuelSeconds: Math.max(0, vehicle.fuelSeconds - seconds),
      });
      this.#vehicles.set(id, state);
      if (vehicle.kind === 'pig') this.context.entities.move(id.slice(4), state.position);
      if (state.riderId) this.context.entities.move(state.riderId, state.position);
    }
  }
  list = () => Object.freeze([...this.#vehicles.values()].sort((a, b) => a.id.localeCompare(b.id)));
  checkpoint = (): VehicleCheckpoint => Object.freeze({ version: 1, sequence: this.#sequence, vehicles: this.list() });
  restore(raw?: VehicleCheckpoint) {
    const value = validateVehicleCheckpoint(raw);
    for (const state of value.vehicles)
      if (state.riderId && this.context.entities.get(state.riderId)?.type !== 'player')
        throw new TypeError('Vehicle rider is missing.');
    this.#sequence = value.sequence;
    this.#vehicles.clear();
    for (const state of value.vehicles) this.#vehicles.set(state.id, state);
  }
}
const distance = (left: readonly number[], right: readonly number[]) =>
  Math.hypot(...left.map((value, axis) => value - right[axis]));
