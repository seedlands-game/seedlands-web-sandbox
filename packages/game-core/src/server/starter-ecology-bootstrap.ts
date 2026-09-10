import type { ActorArchetype } from './gameplay/entity-store';
import type { GameplayContent } from './gameplay/gameplay-content';
import type { GameplayEntity } from './gameplay/entity-store';
import type { ItemStack } from './gameplay/item-registry';
import type { WorldCommitResult } from './game-server-types';
import type { VoxelEdit } from './world-mutation';
import type { ActorRegistration } from './simulation/actor-state';
import type { PoiInput } from './simulation/poi-registry';
import type { SimulationSnapshot } from './simulation/actor-state';
import { createStarterEcology } from './simulation/starter-ecology';
import { findDryStarterSurface } from './starter-surface';
import { Voxel } from '../world/voxel';

type Position = [number, number, number];

export type StarterEcologyBootstrapResult =
  | Readonly<{ configured: false; initialized: false; actorIds: readonly string[] }>
  | Readonly<{ configured: true; initialized: false; actorIds: readonly string[] }>
  | Readonly<{
      configured: true;
      initialized: true;
      actorIds: readonly string[];
      commit: WorldCommitResult;
    }>;

type StarterEcologyBootstrapHost = Readonly<{
  gameplayContent: GameplayContent;
  seed: number;
  generatorVersion: number;
  restoredGameplayVersion: number | null;
  simulationSnapshot(): SimulationSnapshot;
  registerPoi(input: PoiInput): unknown;
  spawnAutonomousActor(input: {
    id: string;
    archetype: ActorArchetype;
    position: Position;
    registration: Omit<ActorRegistration, 'archetype'>;
  }): GameplayEntity;
  spawnWorldItem(position: Position, stack: ItemStack): GameplayEntity;
  editBatch(input: { actorId: string; edits: readonly VoxelEdit[] }): WorldCommitResult;
  updateStarterEcologyVersion(version: number): void;
}>;

export function initializeStarterEcologyBootstrap(
  host: StarterEcologyBootstrapHost,
  center: Position,
  getVoxel: (x: number, y: number, z: number) => number,
): StarterEcologyBootstrapResult {
  const configuration = host.gameplayContent.actorProfiles.starterEcology;
  if (!configuration) return { configured: false, initialized: false, actorIds: [] };
  const current = host.simulationSnapshot();
  if (host.restoredGameplayVersion !== null || current.starterEcologyVersion > 0 || current.actors.length > 0)
    return { configured: true, initialized: false, actorIds: [] };
  for (const actor of configuration.actors) host.gameplayContent.actorProfiles.require(actor.archetype);
  const layout = createStarterEcology(
    host.seed,
    center,
    (x, z) => findDryStarterSurface(host.seed, host.generatorVersion, x, z, getVoxel),
    configuration,
  );
  for (const edit of [...layout.campEdits, ...layout.naturalEdits]) getVoxel(edit.x, edit.y, edit.z);
  const naturalEdits = layout.naturalEdits.filter((edit) => getVoxel(edit.x, edit.y, edit.z) === Voxel.Air);
  layout.pois.forEach((poi) => host.registerPoi(poi));
  const actors = layout.actors.map((actor) => host.spawnAutonomousActor(actor));
  host.spawnWorldItem(layout.foodPosition, layout.initialItem);
  const commit = host.editBatch({
    actorId: `starter-ecology-v${layout.version}`,
    edits: [...layout.campEdits, ...naturalEdits],
  });
  host.updateStarterEcologyVersion(layout.version);
  return { configured: true, initialized: true, actorIds: actors.map((actor) => actor.id), commit };
}
