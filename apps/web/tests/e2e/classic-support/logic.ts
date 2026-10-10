import type { Page } from '@playwright/test';
import type { ClassicWindow } from './harness';
import type { Point } from './scenario';

export type ClassicLogicObservationPhase = 'C3-complete' | 'C4-before-traverse' | 'C4-activity-check-failed';

type LogicEntity = Readonly<{
  id: string;
  bodyKind: string;
  identityRevision: number;
  poseRevision: number;
  position: Point;
  velocity: Point;
  grounded: boolean;
  health?: number;
}>;

type LogicActorState = Readonly<{
  entityId: string;
  archetype: string;
  hunger: number;
  behavior: string;
  targetEntityId: string | null;
  active: boolean;
  wanderIndex: number;
  persistentGoal?: Readonly<{ kind: string; status: string }>;
  behaviorTreeOwned?: true;
}>;

type LogicAction = Readonly<{
  id: string;
  actorId: string;
  type: string;
  status: string;
  targetPosition?: Point;
  targetEntityId?: string;
  poiId?: string;
  startedAt: number;
  endedAt?: number;
  reason?: string;
  path: readonly Point[];
  pathIndex: number;
  repathCount: number;
}>;

type LogicActor = Readonly<{
  state: LogicActorState;
  identityRevision: number;
  activeAction: LogicAction | null;
  controlSource?: string;
}>;

type LogicTerrainWindow = Readonly<{
  key: string;
  chunkRevision: number;
  origin: Point;
  size: Point;
}>;

type LogicPlayerState = Readonly<{
  entityId: string;
  lifecycle: 'alive' | 'dead';
  health: number;
  maxHealth: number;
  hunger: number;
}>;

type LogicObservation = Readonly<{
  epoch: string;
  observationSequence: number;
  physicsTick: number;
  activeTimeMs: number;
  worldTime: number;
  entities: readonly LogicEntity[];
  decisionContext: Readonly<{
    actors: readonly LogicActor[];
    terrainWindows: readonly LogicTerrainWindow[];
  }>;
}>;

export type ClassicLogicObservationEvidence = Readonly<
  | {
      ok: true;
      phase: ClassicLogicObservationPhase;
      mode: string | null;
      epoch: string;
      observationSequence: number;
      physicsTick: number;
      activeTimeMs: number;
      worldTime: number;
      npc: Readonly<{
        entity: LogicEntity | null;
        actor: LogicActor | null;
      }>;
      player: Readonly<{ entity: LogicEntity | null; state: LogicPlayerState | null }>;
      terrainWindows: readonly Readonly<LogicTerrainWindow & { containsNpc: boolean }>[];
    }
  | { ok: false; phase: ClassicLogicObservationPhase; error: string }
>;

export async function captureNpcLogicObservation(
  page: Page,
  npcId: string,
  phase: ClassicLogicObservationPhase,
): Promise<ClassicLogicObservationEvidence> {
  try {
    return await page.evaluate(
      async ({ npcId, phase }) => {
        const harness = (window as unknown as ClassicWindow).__seedlandsHarness;
        if (!harness) throw new Error('Classic Harness is unavailable.');
        const [result, playerResult] = await Promise.all([
          harness.world.logic({ kind: 'observe' }),
          harness.world.command({ type: 'query-player-state' }),
        ]);
        if (!result.ok) throw new Error(`logic observation: ${result.error.code}: ${result.error.message}`);
        if (!playerResult.ok)
          throw new Error(`player state: ${playerResult.error.code}: ${playerResult.error.message}`);
        const data = result.data as Readonly<{ mode?: string; observation?: LogicObservation }>;
        const playerData = playerResult.data as Readonly<{ data?: Readonly<{ player?: LogicPlayerState }> }>;
        if (!data.observation) throw new Error('Authority Logic observation is unavailable.');
        const observation = data.observation;
        const npcEntity = observation.entities.find(({ id }) => id === npcId) ?? null;
        const npcActor = observation.decisionContext.actors.find(({ state }) => state.entityId === npcId) ?? null;
        const player = observation.entities.find(({ bodyKind }) => bodyKind === 'player') ?? null;
        const npcPosition = npcEntity?.position;
        return {
          ok: true as const,
          phase,
          mode: typeof data.mode === 'string' ? data.mode : null,
          epoch: observation.epoch,
          observationSequence: observation.observationSequence,
          physicsTick: observation.physicsTick,
          activeTimeMs: observation.activeTimeMs,
          worldTime: observation.worldTime,
          npc: { entity: npcEntity, actor: npcActor },
          player: { entity: player, state: playerData.data?.player ?? null },
          terrainWindows: observation.decisionContext.terrainWindows.map((window) => ({
            key: window.key,
            chunkRevision: window.chunkRevision,
            origin: window.origin,
            size: window.size,
            containsNpc: Boolean(
              npcPosition &&
              npcPosition.every(
                (coordinate, index) =>
                  coordinate >= window.origin[index]! && coordinate < window.origin[index]! + window.size[index]!,
              ),
            ),
          })),
        };
      },
      { npcId, phase },
    );
  } catch (error) {
    return { ok: false, phase, error: error instanceof Error ? error.message : String(error) };
  }
}
