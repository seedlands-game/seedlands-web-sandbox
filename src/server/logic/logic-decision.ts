import type { ActorAction } from '../simulation/action-runtime';
import { rangeByArchetype, type ActorState } from '../simulation/actor-state';
import type { Poi } from '../simulation/poi-registry';
import {
  LOGIC_INTENT_TTL_MS,
  LOGIC_PROTOCOL_VERSION,
  type LogicEntity,
  type LogicIntent,
  type LogicIntentAction,
  type LogicIntentBatch,
  type LogicObservation,
  type LogicPosition,
} from './logic-protocol';
import { LogicTerrain } from './logic-terrain';

export type LogicDecisionOptions = Readonly<{ physicsHz: 30 | 60 | 120 }>;

const ATTACK_DISTANCE = 1.7;
const CONSUME_DISTANCE = 1.1;
const POI_ARRIVAL_DISTANCE = 0.8;

type ActorObservation = LogicObservation['decisionContext']['actors'][number];
type Goal =
  | Readonly<{ kind: 'hold' }>
  | Readonly<{ kind: 'attack'; target: LogicEntity }>
  | Readonly<{ kind: 'consume'; target: LogicEntity }>
  | Readonly<{ kind: 'move'; target: LogicPosition; targetEntityId?: string; poiId?: string }>;

const finitePosition = (position: readonly number[]) => position.length === 3 && position.every(Number.isFinite);
const distance = (left: LogicPosition, right: LogicPosition) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
const clonePosition = (position: readonly [number, number, number]): LogicPosition => [...position];

function validateObservation(observation: LogicObservation): void {
  if (
    observation.protocolVersion !== LOGIC_PROTOCOL_VERSION ||
    !observation.epoch.trim() ||
    !Number.isInteger(observation.observationSequence) ||
    observation.observationSequence < 0 ||
    !Number.isInteger(observation.physicsTick) ||
    observation.physicsTick < 0 ||
    !Number.isFinite(observation.activeTimeMs) ||
    observation.activeTimeMs < 0 ||
    !Number.isFinite(observation.worldTime)
  )
    throw new TypeError('Logic observation header is invalid.');

  const entities = new Set<string>();
  for (const entity of observation.entities) {
    if (
      !entity.id.trim() ||
      entities.has(entity.id) ||
      !Number.isInteger(entity.identityRevision) ||
      entity.identityRevision < 0 ||
      !Number.isInteger(entity.poseRevision) ||
      entity.poseRevision < 0 ||
      !finitePosition(entity.position) ||
      !finitePosition(entity.velocity)
    )
      throw new TypeError('Logic entity is invalid or duplicated.');
    entities.add(entity.id);
  }

  const actors = new Set<string>();
  for (const entry of observation.decisionContext.actors) {
    if (
      actors.has(entry.state.entityId) ||
      entry.identityRevision < 0 ||
      !Number.isInteger(entry.identityRevision) ||
      (entry.activeAction?.actorId !== undefined && entry.activeAction.actorId !== entry.state.entityId)
    )
      throw new TypeError('Logic actor is invalid or duplicated.');
    actors.add(entry.state.entityId);
  }
}

const nearest = (origin: LogicPosition, entities: readonly LogicEntity[]) =>
  [...entities].sort(
    (left, right) =>
      distance(origin, left.position) - distance(origin, right.position) || left.id.localeCompare(right.id),
  )[0];

const wanderTarget = (actor: ActorState, entity: LogicEntity): LogicPosition => {
  const seed = [...entity.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) + actor.wanderIndex + 1;
  const [dx, dz] = [
    [3, 0],
    [0, 3],
    [-3, 0],
    [0, -3],
  ][seed % 4];
  return [entity.position[0] + dx, entity.position[1], entity.position[2] + dz];
};

const fleeTarget = (entity: LogicEntity, threat: LogicEntity): LogicPosition => {
  const dx = entity.position[0] - threat.position[0];
  const dz = entity.position[2] - threat.position[2];
  const length = Math.hypot(dx, dz) || 1;
  return [entity.position[0] + (dx / length) * 6, entity.position[1], entity.position[2] + (dz / length) * 6];
};

const poiById = (observation: LogicObservation, id: string | null): Poi | undefined =>
  id ? observation.decisionContext.pois.pois.find((poi) => poi.id === id) : undefined;

function visibleNearest(
  source: LogicEntity,
  candidates: readonly LogicEntity[],
  terrain: LogicTerrain,
): LogicEntity | undefined {
  return nearest(
    source.position,
    candidates.filter((candidate) => terrain.lineOfSight(source.position, candidate.position)),
  );
}

function chooseGoal(
  entry: ActorObservation,
  entity: LogicEntity,
  observation: LogicObservation,
  terrain: LogicTerrain,
): Goal {
  const state = entry.state;
  if (!state.active) return { kind: 'hold' };
  const perceptionRange = rangeByArchetype[state.archetype];
  const threat = visibleNearest(
    entity,
    observation.entities.filter(
      (candidate) =>
        candidate.bodyKind === 'night-stalker' &&
        candidate.health !== 0 &&
        distance(entity.position, candidate.position) <= perceptionRange,
    ),
    terrain,
  );
  if (state.archetype !== 'night-stalker' && threat)
    return { kind: 'move', target: fleeTarget(entity, threat), targetEntityId: threat.id };

  if (state.archetype === 'grazer') {
    const food = visibleNearest(
      entity,
      observation.entities.filter(
        (candidate) =>
          candidate.stack?.edible &&
          candidate.stack.count > 0 &&
          distance(entity.position, candidate.position) <= perceptionRange,
      ),
      terrain,
    );
    if (state.hunger >= 50 && food)
      return distance(entity.position, food.position) <= CONSUME_DISTANCE
        ? { kind: 'consume', target: food }
        : { kind: 'move', target: clonePosition(food.position), targetEntityId: food.id };
    return { kind: 'move', target: wanderTarget(state, entity) };
  }

  if (state.archetype === 'night-stalker') {
    const isNight = observation.worldTime >= 18 || observation.worldTime < 6;
    const player = isNight
      ? visibleNearest(
          entity,
          observation.entities.filter(
            (candidate) =>
              candidate.bodyKind === 'player' &&
              candidate.health !== 0 &&
              distance(entity.position, candidate.position) <= perceptionRange,
          ),
          terrain,
        )
      : undefined;
    if (player)
      return distance(entity.position, player.position) <= ATTACK_DISTANCE
        ? { kind: 'attack', target: player }
        : { kind: 'move', target: clonePosition(player.position), targetEntityId: player.id };
    const home = poiById(observation, state.homePoiId);
    if (home && distance(entity.position, home.position) > POI_ARRIVAL_DISTANCE)
      return { kind: 'move', target: clonePosition(home.position), poiId: home.id };
    return { kind: 'hold' };
  }

  if (state.hunger >= 60) {
    const food = poiById(observation, state.foodPoiId);
    if (food && distance(entity.position, food.position) > POI_ARRIVAL_DISTANCE)
      return { kind: 'move', target: clonePosition(food.position), poiId: food.id };
  }
  const daytime = observation.worldTime >= 6 && observation.worldTime < 18;
  const routine = poiById(observation, daytime ? state.workPoiId : state.homePoiId);
  if (routine && distance(entity.position, routine.position) > POI_ARRIVAL_DISTANCE)
    return { kind: 'move', target: clonePosition(routine.position), poiId: routine.id };
  return routine ? { kind: 'hold' } : { kind: 'move', target: wanderTarget(state, entity) };
}

const samePosition = (left?: readonly number[], right?: readonly number[]) =>
  Boolean(left && right && left.every((value, index) => Math.abs(value - right[index]) <= 1e-6));

function matchesAction(goal: Goal, action: ActorAction | null): boolean {
  if (!action) return false;
  if (goal.kind === 'attack') return action.type === 'attack' && action.targetEntityId === goal.target.id;
  if (goal.kind === 'consume') return action.type === 'eat' && action.targetEntityId === goal.target.id;
  if (goal.kind !== 'move') return action.type === 'idle';
  if (goal.targetEntityId && action.targetEntityId === goal.targetEntityId) return true;
  if (goal.poiId && action.poiId === goal.poiId) return true;
  return samePosition(action.targetPosition, goal.target);
}

function actionFor(goal: Goal, activeAction: ActorAction | null): LogicIntentAction | undefined {
  if (matchesAction(goal, activeAction) && activeAction)
    return { type: 'start-existing-action', actionId: activeAction.id };
  if (goal.kind === 'attack') return { type: 'attack', targetId: goal.target.id };
  if (goal.kind === 'consume') return { type: 'consume-world-item', targetId: goal.target.id };
  if (goal.kind === 'move') return { type: 'move-to', target: clonePosition(goal.target) };
  return undefined;
}

function holdIntent(entry: ActorObservation, entity: LogicEntity, terrain: LogicTerrain): LogicIntent {
  return {
    entityId: entity.id,
    identityRevision: entry.identityRevision,
    observedPoseRevision: entity.poseRevision,
    readChunkRevisions: terrain.readRevisions(),
    wish: { x: 0, z: 0 },
    jumpRequested: false,
    verticalIntent: 0,
  };
}

function decideActor(entry: ActorObservation, observation: LogicObservation): LogicIntent | null {
  const entity = observation.entities.find((candidate) => candidate.id === entry.state.entityId);
  if (!entity || entity.identityRevision !== entry.identityRevision) return null;
  const terrain = new LogicTerrain(observation.decisionContext.terrainWindows);
  const goal = chooseGoal(entry, entity, observation, terrain);
  if (terrain.hasMissingData || goal.kind === 'hold') return holdIntent(entry, entity, terrain);

  let wish = { x: 0, z: 0 };
  let jumpRequested = false;
  if (goal.kind === 'move') {
    const step = terrain.nextStep(entity.bodyKind, entity.position, goal.target);
    if (!step || terrain.hasMissingData) return holdIntent(entry, entity, terrain);
    wish = step.wish;
    jumpRequested = step.jumpRequested && entity.grounded;
  }
  return {
    entityId: entity.id,
    identityRevision: entry.identityRevision,
    observedPoseRevision: entity.poseRevision,
    readChunkRevisions: terrain.readRevisions(),
    wish,
    jumpRequested,
    verticalIntent: 0,
    ...(actionFor(goal, entry.activeAction) ? { action: actionFor(goal, entry.activeAction) } : {}),
  };
}

export function decideLogicIntents(observation: LogicObservation, options: LogicDecisionOptions): LogicIntentBatch {
  validateObservation(observation);
  if (![30, 60, 120].includes(options.physicsHz)) throw new TypeError('Logic physics frequency is invalid.');
  new LogicTerrain(observation.decisionContext.terrainWindows);
  return {
    protocolVersion: LOGIC_PROTOCOL_VERSION,
    epoch: observation.epoch,
    observationSequence: observation.observationSequence,
    expiresAtPhysicsTick: observation.physicsTick + Math.ceil((options.physicsHz * LOGIC_INTENT_TTL_MS) / 1_000),
    intents: observation.decisionContext.actors
      .map((entry) => decideActor(entry, observation))
      .filter((intent): intent is LogicIntent => intent !== null),
  };
}
