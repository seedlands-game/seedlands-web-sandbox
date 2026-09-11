import type { ItemDefinitionRegistry } from './item-registry';
import type {
  ActorFlightComponentV1,
  ActorModeComponentV1,
  ActorModeSnapshotFacets,
  CreativeCatalogComponentV1,
  createActorComponents,
} from './ecs-actor-components';

type Components = ReturnType<typeof createActorComponents>;
const CREATIVE_HOTBAR_SIZE = 8;
export type CompleteModeFacets = Readonly<{
  mode: ActorModeComponentV1;
  creativeCatalog: CreativeCatalogComponentV1;
  flight: ActorFlightComponentV1;
}>;

export const defaultActorModeFacets = (): CompleteModeFacets => ({
  mode: { version: 1, value: 'survival', revision: 0 },
  creativeCatalog: {
    version: 1,
    hotbar: Object.freeze(Array.from({ length: CREATIVE_HOTBAR_SIZE }, () => null)),
    selectedSlot: 0,
    revision: 0,
  },
  flight: { version: 1, enabled: false, revision: 0 },
});

const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function validateActorModeFacets(
  facets: ActorModeSnapshotFacets,
  items: ItemDefinitionRegistry,
): CompleteModeFacets {
  const supplied = [facets.mode, facets.creativeCatalog, facets.flight].filter((value) => value !== undefined).length;
  if (supplied === 0) return defaultActorModeFacets();
  if (supplied !== 3) throw new TypeError('Actor mode component snapshots must be supplied together.');
  const mode = facets.mode!;
  const catalog = facets.creativeCatalog!;
  const flight = facets.flight!;
  if (mode.version !== 1 || !['survival', 'creative'].includes(mode.value) || !validRevision(mode.revision))
    throw new TypeError('Actor mode component snapshot is invalid.');
  if (
    catalog.version !== 1 ||
    !Array.isArray(catalog.hotbar) ||
    catalog.hotbar.length !== CREATIVE_HOTBAR_SIZE ||
    !Number.isSafeInteger(catalog.selectedSlot) ||
    catalog.selectedSlot < 0 ||
    catalog.selectedSlot >= CREATIVE_HOTBAR_SIZE ||
    !validRevision(catalog.revision) ||
    [...catalog.hotbar].some((itemId) => itemId !== null && (typeof itemId !== 'string' || !items.has(itemId)))
  )
    throw new TypeError('Creative catalog component snapshot is invalid.');
  if (flight.version !== 1 || typeof flight.enabled !== 'boolean' || !validRevision(flight.revision))
    throw new TypeError('Actor flight component snapshot is invalid.');
  if (mode.value === 'survival' && flight.enabled)
    throw new TypeError('Survival actor cannot have creative flight enabled.');
  return {
    mode: { ...mode },
    creativeCatalog: { ...catalog, hotbar: Object.freeze([...catalog.hotbar]) },
    flight: { ...flight },
  };
}

export const readActorMode = (components: Components, eid: number): ActorModeComponentV1 => ({
  version: 1,
  value: components.mode.value[eid]!,
  revision: components.mode.revision[eid]!,
});

export const readActorCreativeCatalog = (components: Components, eid: number): CreativeCatalogComponentV1 => ({
  version: 1,
  hotbar: Object.freeze([...(components.creativeCatalog.hotbar[eid] ?? [])]),
  selectedSlot: components.creativeCatalog.selectedSlot[eid]!,
  revision: components.creativeCatalog.revision[eid]!,
});

export const readActorFlight = (components: Components, eid: number): ActorFlightComponentV1 => ({
  version: 1,
  enabled: components.flight.enabled[eid]!,
  revision: components.flight.revision[eid]!,
});

export function writeActorModeFacets(components: Components, eid: number, facets: CompleteModeFacets): void {
  components.mode.value[eid] = facets.mode.value;
  components.mode.revision[eid] = facets.mode.revision;
  components.creativeCatalog.hotbar[eid] = Object.freeze([...facets.creativeCatalog.hotbar]);
  components.creativeCatalog.selectedSlot[eid] = facets.creativeCatalog.selectedSlot;
  components.creativeCatalog.revision[eid] = facets.creativeCatalog.revision;
  components.flight.enabled[eid] = facets.flight.enabled;
  components.flight.revision[eid] = facets.flight.revision;
}
