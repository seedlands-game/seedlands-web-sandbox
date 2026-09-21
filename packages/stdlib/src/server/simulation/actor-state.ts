import type { ActorArchetype } from '../gameplay/entity-store';
import type { ActionRuntime } from './action-runtime';
import type { PoiSnapshot } from './poi-registry';
import type { CombatRuntimeSnapshot } from '../gameplay/combat-runtime';
import type { CharacterGoal } from '../../runtime/character-control-protocol';
import type { CharacterSnapshot } from './character-runtime-types';

export type ActorBehavior =
  'idle' | 'wander' | 'seek-food' | 'flee' | 'chase' | 'attack' | 'routine-home' | 'routine-work';

export type ActorPersistentGoal = Readonly<{
  kind: CharacterGoal['kind'];
  status: 'active' | 'suspended';
}>;

export type ActorState = {
  entityId: string;
  archetype: ActorArchetype;
  disposition?: 'passive' | 'neutral' | 'hostile';
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
  /** Derived from the ECS behavior component; never serialized as a second owner. */
  persistentGoal?: ActorPersistentGoal;
  /** Derived marker that behavior control owns this actor's decisions. */
  behaviorTreeOwned?: true;
};
export const actorDisposition = (actor: Pick<ActorState, 'archetype' | 'disposition'>) =>
  actor.disposition ??
  (actor.archetype === 'night-stalker' ? 'hostile' : actor.archetype === 'settler' ? 'neutral' : 'passive');

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
  /** Legacy Agent-line owner; migrated into ECS actor behavior components and never emitted by new snapshots. */
  characters?: CharacterSnapshot;
  /** Bounded terminal history for Character entities whose ECS bodies were removed. */
  characterTombstones?: CharacterSnapshot;
};

export const MAX_RETAINED_ACTORS = 512;
export const ACTIVE_RADIUS_SQUARED = 48 ** 2;
export const STEP_SECONDS = 0.1;
export const speedByArchetype: Readonly<Record<ActorArchetype, number>> = {
  grazer: 1.6,
  'night-stalker': 2.2,
  settler: 1.4,
  chicken: 1.8,
  cow: 2,
  pig: 2,
  'pig-zombie': 2.3,
  sheep: 2,
  squid: 1.4,
  wolf: 2.4,
  zombie: 2.3,
  skeleton: 2.4,
  spider: 2.8,
  creeper: 2.3,
  slime: 2,
};
export const rangeByArchetype: Readonly<Record<ActorArchetype, number>> = {
  grazer: 10,
  'night-stalker': 12,
  settler: 10,
  chicken: 8,
  cow: 10,
  pig: 10,
  'pig-zombie': 12,
  sheep: 10,
  squid: 8,
  wolf: 12,
  zombie: 12,
  skeleton: 16,
  spider: 12,
  creeper: 12,
  slime: 10,
};
export const cloneActor = (actor: ActorState, attackCooldownSeconds?: number): ActorState => {
  const cloned = { ...actor };
  delete cloned.attackCooldownSeconds;
  delete cloned.persistentGoal;
  delete cloned.behaviorTreeOwned;
  return attackCooldownSeconds === undefined ? cloned : { ...cloned, attackCooldownSeconds };
};
export const roundSimulation = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
export const simulationDistanceSquared = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
