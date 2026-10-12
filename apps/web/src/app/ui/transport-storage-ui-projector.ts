import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { GameplayItemPresentation } from './gameplay-ui-projector';

type Site = NonNullable<AuthorityGameplayView['transportStorage']>[number];
export type TransportStorageUiPresentation = Readonly<{
  identity: string;
  name: string;
  slots: readonly GameplayItemPresentation[];
  fuel: number | null;
  fuelCapacity: number | null;
  fuelItemIds: readonly string[];
  inventoryRevision: number;
  revision: number;
}>;
export function projectTransportStorageUi(
  site: Site | null | undefined,
  actorIdentity: unknown,
  inventoryRevision: number,
  slots: (input: Site['inventory'], length: number) => readonly GameplayItemPresentation[],
): TransportStorageUiPresentation | null {
  return site
    ? {
        identity: JSON.stringify([actorIdentity, inventoryRevision, site.reference, site.revision]),
        name: site.inventory.length ? '载具货箱' : '载具燃料',
        slots: slots(site.inventory, site.inventory.length),
        fuel: site.fuel,
        fuelCapacity: site.fuelCapacity,
        fuelItemIds: site.fuels.map((entry) => entry.itemId),
        inventoryRevision,
        revision: site.revision,
      }
    : null;
}
