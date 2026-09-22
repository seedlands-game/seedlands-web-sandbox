import type { GameServer } from '../game-server';
import type { AuthorityGameplayView, AuthorityReady } from '../protocol/authority-worker-protocol';
import type { AuthoritySnapshot } from './authority-session';
import type { AuthorityResidencyDiagnostics } from './authority-residency-runtime';
import { withAuthorityResidencyDiagnostics } from './authority-snapshot-diagnostics';

type Input = Readonly<{
  server: GameServer;
  playerId: string;
  playerBodyPosition: [number, number, number];
  isNew: boolean;
  seedText: string;
  frequencies: AuthorityReady['frequencies'];
  snapshot: AuthoritySnapshot;
  residency: AuthorityResidencyDiagnostics;
  gameplay: AuthorityGameplayView;
}>;

export function projectAuthorityReady(input: Input): AuthorityReady {
  const camp = input.server.queryPois(input.playerBodyPosition, 40, 'camp')[0];
  return {
    playerId: input.playerId,
    playerBodyPosition: [...input.playerBodyPosition],
    isNew: input.isNew,
    seed: input.server.seed,
    seedText: input.seedText,
    generatorVersion: input.server.generatorVersion,
    ...(input.server.worldgenProvider ? { worldgenProvider: input.server.worldgenProvider } : {}),
    worldTime: input.server.worldTime,
    frequencies: input.frequencies,
    snapshot: withAuthorityResidencyDiagnostics(input.snapshot, input.residency),
    gameplay: input.gameplay,
    voxelSemantics: input.server.voxelSemantics.list(),
    ...(input.server.restoredSnapshotMigrationReports.length
      ? { snapshotMigrationReports: input.server.restoredSnapshotMigrationReports }
      : {}),
    ...(camp ? { campPosition: [...camp.position] as [number, number, number] } : {}),
  };
}
