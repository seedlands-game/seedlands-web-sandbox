import { Voxel } from '../../world/voxel';
import type { ActorArchetype } from '../gameplay/entity-store';
import type { VoxelEdit } from '../world-mutation';
import type { ActorRegistration } from './actor-state';
import type { PoiInput } from './poi-registry';
import type { ItemStack } from '../gameplay/item-registry';
import type { StarterEcologyConfiguration } from '../gameplay/actor-profile';
import { overworldStarterEcology } from '../gameplay/playbooks/overworld/actors';

type Position = [number, number, number];
type StarterActor = {
  id: string;
  archetype: ActorArchetype;
  position: Position;
  registration: Omit<ActorRegistration, 'archetype'>;
};
export type StarterEcology = {
  version: 1;
  pois: PoiInput[];
  actors: StarterActor[];
  foodPosition: Position;
  initialItem: ItemStack;
  campEdits: VoxelEdit[];
  naturalEdits: VoxelEdit[];
};

export function createStarterEcology(
  seed: number,
  center: readonly [number, number, number],
  findSurface: (x: number, z: number, nearY: number) => Position,
  configuration: StarterEcologyConfiguration = overworldStarterEcology,
): StarterEcology {
  const direction = seed % 2 === 0 ? 1 : -1;
  const token = Math.abs(seed).toString(36);
  const point = (dx: number, dz: number): Position => {
    const x = Math.floor(center[0]) + dx * direction;
    const z = Math.floor(center[2]) + dz;
    return findSurface(x, z, center[1]);
  };
  const camp = point(8, 4);
  const tree = point(6, -4);
  const home = { id: `starter-home-${token}`, kind: 'home' as const, position: camp, label: '石木营地住所' };
  const work = { id: `starter-work-${token}`, kind: 'work' as const, position: point(10, 4), label: '营地工作点' };
  const food = { id: `starter-food-${token}`, kind: 'food' as const, position: point(7, 7), label: '营地食物点' };
  const marker = { id: `starter-camp-${token}`, kind: 'camp' as const, position: camp, label: '石木营地' };
  const lair = { id: `starter-lair-${token}`, kind: 'home' as const, position: point(-1, 0), label: '夜行兽巢位' };
  const campX = Math.floor(camp[0]);
  const campY = Math.floor(camp[1]);
  const campZ = Math.floor(camp[2]);
  const campEdits: VoxelEdit[] = [];
  for (let x = campX - 1; x <= campX + 1; x += 1)
    for (let z = campZ - 1; z <= campZ + 1; z += 1) campEdits.push({ x, y: campY - 1, z, value: Voxel.Stone });
  for (const [x, z] of [
    [campX - 1, campZ - 1],
    [campX + 1, campZ + 1],
  ]) {
    campEdits.push({ x, y: campY, z, value: Voxel.Wood });
    campEdits.push({ x, y: campY + 1, z, value: Voxel.Wood });
  }
  const treeX = Math.floor(tree[0]);
  const treeY = Math.floor(tree[1]);
  const treeZ = Math.floor(tree[2]);
  const naturalEdits: VoxelEdit[] = [0, 1, 2].map((dy) => ({
    x: treeX,
    y: treeY + dy,
    z: treeZ,
    value: Voxel.Wood,
  }));
  for (let dx = -1; dx <= 1; dx += 1)
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      naturalEdits.push({ x: treeX + dx, y: treeY + 2, z: treeZ + dz, value: Voxel.Leaves });
    }
  naturalEdits.push({ x: treeX, y: treeY + 3, z: treeZ, value: Voxel.Leaves });
  return {
    version: 1,
    pois: [home, work, food, marker, lair],
    actors: configuration.actors.map((actor): StarterActor => {
      const registration =
        actor.slot === 'predator'
          ? { homePoiId: lair.id }
          : actor.slot === 'resident'
            ? { homePoiId: home.id, workPoiId: work.id, foodPoiId: food.id }
            : {};
      return {
        id: `${actor.idPrefix}-${token}`,
        archetype: actor.archetype,
        position: actor.slot === 'forager' ? point(4, 2) : actor.slot === 'predator' ? lair.position : camp,
        registration: { ...registration, ...(actor.hunger !== undefined ? { hunger: actor.hunger } : {}) },
      };
    }),
    foodPosition: point(5, 2),
    initialItem: configuration.initialItem,
    campEdits,
    naturalEdits,
  };
}
