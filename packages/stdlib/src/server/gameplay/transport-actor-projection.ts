import type { EntityStore } from './entity-store';
import type { TransportDeploymentActorV1 } from './modules/transport-deployment-model';

export function projectTransportActor(entities: EntityStore, id: string): TransportDeploymentActorV1 {
  const entity = entities.get(id);
  const reference = entities.createReference(id);
  if (!reference || entity?.type !== 'player') throw new Error('transport-actor-unavailable');
  const components = entities.actorComponentSnapshot(id);
  const mode = components.mode;
  const catalog = components.creativeCatalog;
  if (!mode || !catalog) throw new Error('transport-actor-mode-unavailable');
  const creative = mode.value === 'creative';
  const selectedSlot = creative ? catalog.selectedSlot : components.equipment.selectedSlot;
  const itemId = creative
    ? (catalog.hotbar[selectedSlot] ?? null)
    : (components.inventory[selectedSlot]?.itemId ?? null);
  return Object.freeze({
    version: 1,
    reference,
    position: Object.freeze([...entity.position]) as typeof entity.position,
    alive: entity.health! > 0 && components.lifecycle === 'alive',
    mode: mode.value,
    modeRevision: mode.revision,
    inventoryRevision: components.inventoryRevision ?? 0,
    creativeCatalogRevision: catalog.revision,
    selectedSlot,
    itemId,
    count: creative ? Number(itemId !== null) : (components.inventory[selectedSlot]?.count ?? 0),
  });
}
