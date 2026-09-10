import type {
  AuthorityGameplayView,
  AuthorityStationAction,
  AuthorityStationView,
} from '@seedlands/game-core/compute/authority-worker-protocol';

export type StationUiCommand =
  | Readonly<{ kind: 'craft'; recipeId: string }>
  | Readonly<{ kind: 'transfer'; from: 'actor' | 'station'; actorSlot: number; stationSlot: number; count?: number }>;

/** Only the selected identity lives here; slots and revisions always come from Authority. */
export class BrowserStations {
  private selected: AuthorityStationView['reference'] | null = null;
  constructor(private readonly view: () => AuthorityGameplayView) {}
  clear() {
    this.selected = null;
  }
  open(position: readonly [number, number, number]): boolean {
    const station = this.view().nearbyStations?.find((entry) =>
      entry.position.every((value, axis) => value === position[axis]),
    );
    this.selected = station?.reference ?? null;
    return Boolean(station);
  }
  current(): AuthorityStationView | null {
    const station = this.view().nearbyStations?.find(
      (entry) => JSON.stringify(entry.reference) === JSON.stringify(this.selected),
    );
    if (!station) this.clear();
    return station ?? null;
  }
  action(command: StationUiCommand): AuthorityStationAction | null {
    const station = this.current();
    return station
      ? {
          type: 'station',
          reference: station.reference,
          expectedStationRevision: station.component.revision,
          ...command,
        }
      : null;
  }
}
