import type { GameplaySnapshotV4 } from '../../../../../packages/stdlib/src/server/gameplay/gameplay-snapshot';

/** Focused old-identity fixtures must also omit the system introduced by the new target Pack. */
export function preTransportGameplayFixture(snapshot: GameplaySnapshotV4): GameplaySnapshotV4 {
  return {
    ...snapshot,
    ...(snapshot.moduleSchedule
      ? {
          moduleSchedule: {
            ...snapshot.moduleSchedule,
            systems: snapshot.moduleSchedule.systems.filter(({ id }) => id !== 'seedlands:minecart-motion'),
          },
        }
      : {}),
  };
}
