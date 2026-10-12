import type { EntityStore } from './entity-store';
import type { GameplayContent } from './gameplay-content';
import type { WorldComposition } from '../composition/contracts';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import { playerInteractionOrigin, positionsInRange } from './gameplay-geometry';
import { traceVoxelRay } from './voxel-ray';
import { cloneItemStack } from './item-instance';
import { TRANSPORT_STORAGE_CAPABILITY, type TransportStorageConfigV1 } from './modules/transport-storage-module';
import type { EntityLifetimeReference } from './ecs-entity-owner';
import type { InventorySlot } from './inventory';
import type { TransportFuelBindingV1 } from './modules/transport-storage-model';

type Point = readonly [number, number, number];
export type TransportStorageViewV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  definitionId: string;
  revision: number;
  inventory: readonly InventorySlot[];
  fuel: number | null;
  fuelCapacity: number | null;
  fuels: readonly TransportFuelBindingV1[];
}>;

/** Used by both readonly UI projection and prepared owner authorization. */
export function transportStorageAccess(
  content: GameplayContent,
  getLoadedVoxel: GameplayCallbacks['getLoadedVoxel'],
  actor: Point,
  carrier: Point,
): 'clear' | 'out-of-range' | 'chunk-unavailable' | 'blocked' {
  const origin = playerInteractionOrigin(actor);
  if (!positionsInRange(origin, carrier, 5)) return 'out-of-range';
  const status = traceVoxelRay(
    carrier,
    origin,
    (x, y, z) => getLoadedVoxel?.([x, y, z]),
    (voxel) => content.voxelSemantics.get(voxel)?.solid ?? true,
  );
  return status === 'clear' ? 'clear' : status === 'unavailable' ? 'chunk-unavailable' : 'blocked';
}

export function projectTransportStorageViews(
  entities: EntityStore,
  content: GameplayContent,
  composition: WorldComposition | undefined,
  actorId: string,
  getLoadedVoxel: GameplayCallbacks['getLoadedVoxel'],
): readonly TransportStorageViewV1[] | undefined {
  if (!composition?.definitionMap.capabilities.some(({ id }) => id === TRANSPORT_STORAGE_CAPABILITY)) return undefined;
  const storage = composition.capability<TransportStorageConfigV1>(TRANSPORT_STORAGE_CAPABILITY);
  const actor = entities.get(actorId);
  if (
    actor?.type !== 'player' ||
    !(actor.health! > 0) ||
    entities.actorComponentSnapshot(actorId).lifecycle !== 'alive'
  )
    return Object.freeze([]);
  return Object.freeze(
    entities.query({ type: 'transport' }).flatMap((entity) => {
      const component = entities.transportComponentSnapshot(entity.id);
      const definition = content.transportDefinitions!.require(component.definitionId);
      if (
        (definition.inventoryCapacity === null && definition.fuelCapacity === null) ||
        transportStorageAccess(content, getLoadedVoxel, actor.position, entity.position) !== 'clear'
      )
        return [];
      return [
        Object.freeze({
          version: 1 as const,
          reference: Object.freeze({ ...entities.createReference(entity.id)! }),
          definitionId: component.definitionId,
          revision: component.revision,
          inventory: Object.freeze(component.inventory.map((slot) => slot && Object.freeze(cloneItemStack(slot)))),
          fuel: component.fuel,
          fuelCapacity: definition.fuelCapacity,
          fuels: Object.freeze(
            storage.fuels
              .filter((binding) => binding.definitionId === component.definitionId)
              .map((binding) => Object.freeze({ ...binding })),
          ),
        }),
      ];
    }),
  );
}
