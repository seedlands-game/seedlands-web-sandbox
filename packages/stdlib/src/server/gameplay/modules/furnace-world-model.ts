import type { GameplayContent } from '../gameplay-content';
import type { StationComponentV1 } from '../ecs-station-state';
import { advanceFurnaceCandidate } from './furnace-candidates';
import { validateStationProjection, type StationProjectionV1 } from './station-action-model';

export const FURNACE_WORLD_COMPONENT = 'seedlands:furnace-world';
export const FURNACE_RESOURCE = 'seedlands.furnace-clock';
export const FURNACE_ADVANCE_OPERATION = 'seedlands:furnace-advance';
export const FURNACE_SYSTEM = 'seedlands:furnace-system';
export const FURNACE_PARTITIONS = 8;
export const FURNACE_PARTITION_SIZE = 128;
export const furnaceWorldAddress = (partition: number) => ({
  componentId: FURNACE_WORLD_COMPONENT,
  target: { kind: 'world' as const },
  partition,
});
export function furnaceActive(component: StationComponentV1, content: GameplayContent): boolean {
  if (component.kind !== 'furnace' || !component.furnace.input) return false;
  const furnace = content.stations!.codec.furnace;
  const recipe = furnace.recipeForInput(component.furnace.input.itemId);
  return (
    !!recipe &&
    component.furnace.input.count >= recipe.input.count &&
    (component.furnace.remainingFuelSeconds > 0 || !!component.furnace.fuel)
  );
}
export function validateFurnacePartition(raw: unknown, content: GameplayContent) {
  const value = raw as { version?: unknown; partition?: unknown; entries?: unknown };
  if (
    !value ||
    value.version !== 1 ||
    typeof value.partition !== 'number' ||
    !Number.isSafeInteger(value.partition) ||
    value.partition < 0 ||
    value.partition >= FURNACE_PARTITIONS ||
    !Array.isArray(value.entries) ||
    value.entries.length > FURNACE_PARTITION_SIZE
  )
    throw new TypeError('Invalid furnace world partition.');
  const entries = value.entries.map((entry) => validateStationProjection(entry, content));
  let previous = '';
  for (const entry of entries) {
    if (entry.component.kind !== 'furnace' || entry.reference.entityId <= previous)
      throw new TypeError('Invalid furnace membership order.');
    previous = entry.reference.entityId;
  }
  return { version: 1 as const, partition: value.partition, entries };
}
export function furnaceSeconds(raw: unknown): number {
  const input = raw as { seconds?: unknown };
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => key !== 'seconds') ||
    typeof input.seconds !== 'number' ||
    !Number.isFinite(input.seconds) ||
    input.seconds < 0 ||
    input.seconds > 1
  )
    throw new TypeError('Furnace logical step must be 0..1 seconds.');
  return input.seconds;
}
export function buildFurnaceWorldCandidate(
  entries: readonly StationProjectionV1[],
  seconds: number,
  content: GameplayContent,
) {
  const updates: StationProjectionV1[] = [];
  let previous = '';
  for (const entry of entries) {
    if (entry.reference.entityId <= previous || entry.component.kind !== 'furnace')
      throw new TypeError('Invalid furnace world membership.');
    previous = entry.reference.entityId;
    const advanced = advanceFurnaceCandidate(entry.component.furnace, seconds, content.stations!.codec.furnace);
    if (JSON.stringify(advanced.snapshot) === JSON.stringify(entry.component.furnace)) continue;
    if (entry.component.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Furnace revision exhausted.');
    updates.push({
      ...entry,
      component: content.stations!.codec.decode({
        ...entry.component,
        revision: entry.component.revision + 1,
        furnace: advanced.snapshot,
      }),
    });
  }
  return { version: 1 as const, kind: 'furnace-advance' as const, seconds, updates };
}
