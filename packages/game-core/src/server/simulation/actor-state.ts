import type { ActorArchetype } from '../gameplay/entity-store';
import type { ActionRuntime } from './action-runtime';
import type { PoiSnapshot } from './poi-registry';
import type { CombatRuntimeSnapshot } from '../gameplay/combat-runtime';
import type { CharacterSnapshot } from './character-runtime';
import type { CharacterGoal } from '../../runtime/character-control-protocol';

export type ActorBehavior =
  'idle' | 'wander' | 'seek-food' | 'flee' | 'chase' | 'attack' | 'routine-home' | 'routine-work';

export type ActorPersistentGoal = Readonly<{
  kind: CharacterGoal['kind'];
  status: 'active' | 'suspended';
}>;

export type ActorState = {
  entityId: string;
  archetype: ActorArchetype;
  hunger: number;
  behavior: ActorBehavior;
  targetEntityId: string | null;
  homePoiId: string | null;
  workPoiId: string | null;
  foodPoiId: string | null;
  active: boolean;
  /** Legacy projection; the combat runtime is the only mutable cooldown owner. */
  attackCooldownSeconds?: number;
  wanderIndex: number;
  /** Derived Character ownership projection. Restore rebuilds it from the Character record. */
  persistentGoal?: ActorPersistentGoal;
};

export type ActorRegistration = {
  archetype: ActorArchetype;
  hunger?: number;
  homePoiId?: string;
  workPoiId?: string;
  foodPoiId?: string;
};

export type SimulationSnapshot = {
  version: 1;
  time: number;
  stepAccumulator: number;
  needsAccumulator: number;
  perceptionAccumulator: number;
  behaviorAccumulator: number;
  starterEcologyVersion: number;
  actors: ActorState[];
  pois: PoiSnapshot;
  actions: ReturnType<ActionRuntime['snapshot']>;
  combat?: CombatRuntimeSnapshot;
  /** Missing in pre-character saves and migrated to an empty character catalog. */
  characters?: CharacterSnapshot;
};

export const MAX_RETAINED_ACTORS = 512;
export const ACTIVE_RADIUS_SQUARED = 48 ** 2;
export const STEP_SECONDS = 0.1;
export const speedByArchetype: Readonly<Record<ActorArchetype, number>> = {
  grazer: 1.6,
  'night-stalker': 2.2,
  settler: 1.4,
};
export const rangeByArchetype: Readonly<Record<ActorArchetype, number>> = {
  grazer: 10,
  'night-stalker': 12,
  settler: 10,
};
export const cloneActor = (actor: ActorState, attackCooldownSeconds?: number): ActorState => {
  const cloned = { ...actor };
  delete cloned.attackCooldownSeconds;
  delete cloned.persistentGoal;
  return attackCooldownSeconds === undefined ? cloned : { ...cloned, attackCooldownSeconds };
};
export const roundSimulation = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
export const simulationDistanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
