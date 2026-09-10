import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  CHARACTER_ARRIVAL_RADIUS,
  createLifeBehavior,
  type CharacterObservation,
  type CharacterPosition,
} from '@seedlands/game-core/runtime/character-control-protocol';
import { prepareFlatMovement, startHarnessWorld } from '../../../tests/e2e/support/harness';
import type { PlayerSnapshot } from '@seedlands/game-core/server/gameplay/player-state';

export const lifeScene = JSON.parse(readFileSync(new URL('../fixtures/life-scene.json', import.meta.url), 'utf8')) as {
  seed: string;
  floor: { from: CharacterPosition; to: CharacterPosition; voxel: number };
  air: { from: CharacterPosition; to: CharacterPosition; voxel: number };
  actorPosition: CharacterPosition;
  homePosition: CharacterPosition;
  patrolPositions: CharacterPosition[];
  food: { position: CharacterPosition; itemId: string; count: number }[];
  playerFood: { itemId: string; count: number; useEverySimulatedSeconds: number };
  duration: { headlessSimulatedSeconds: number; browserWallSeconds: number };
};

export const definitionHash = (observation: CharacterObservation) =>
  createHash('sha256').update(JSON.stringify(observation.character.behaviorTree.definition)).digest('hex');

export async function startLifeScene(page: Page) {
  await page.addInitScript(() => localStorage.setItem('seedlands.quality.v1', 'low'));
  await startHarnessWorld(page, lifeScene.seed);
  await prepareFlatMovement(page);
  const birth = createLifeBehavior({
    homePosition: lifeScene.homePosition,
    patrolPositions: lifeScene.patrolPositions,
    hungerStart: 40,
    hungerSatisfied: 20,
    threatResponse: 'flee',
  });
  const character = await page.evaluate(
    async ({ scene, behaviorTree }) => {
      const harness = window.__seedlandsHarness!;
      const world = harness.world;
      await world.clock({ kind: 'pause' });
      const nearby = await world.command({ type: 'query-nearby', radius: 128 });
      if (!nearby.ok || !nearby.data.success) throw new Error('Scene entity inventory unavailable');
      for (const entity of (nearby.data.data as { entities?: { id: string; type: string }[] } | undefined)?.entities ??
        [])
        if (entity.type !== 'player') {
          const removed = await world.command({ type: 'despawn-entity', entityId: entity.id });
          if (!removed.ok || !removed.data.success) throw new Error('Scene entity removal failed');
        }
      for (const box of [scene.floor, scene.air]) {
        const result = await world.command({ type: 'fill', ...box });
        if (!result.ok || !result.data.success) throw new Error(`Life floor: ${JSON.stringify(result)}`);
      }
      const moved = await world.command({ type: 'teleport', position: [0.5, 58.6, 6.5] });
      if (!moved.ok || !moved.data.success) throw new Error('Player scene position unavailable');
      for (const food of scene.food) {
        const result = await world.command({ type: 'spawn-world-item', ...food });
        if (!result.ok || !result.data.success) throw new Error(`Life food: ${JSON.stringify(result)}`);
      }
      const given = await world.command({
        type: 'give-item',
        itemId: scene.playerFood.itemId,
        count: scene.playerFood.count,
      });
      if (!given.ok || !given.data.success) throw new Error('Player provision failed');
      const result = await world.character({
        kind: 'create',
        profile: { name: '阿岚', personality: '谨慎而好奇，白天照看周围，入夜回到落脚处，饿了认真吃饱。' },
        position: scene.actorPosition,
        homePosition: scene.homePosition,
        behaviorTree,
      });
      if (!result.ok || result.data.kind !== 'created') throw new Error(`Life birth: ${JSON.stringify(result)}`);
      harness.setTimePaused(false);
      harness.setTimeSpeed(1);
      return result.data.character;
    },
    { scene: lifeScene, behaviorTree: birth },
  );
  await page.keyboard.press('F3');
  await page.locator('#debug').waitFor({ state: 'hidden' });
  await page.keyboard.press('KeyT');
  await page.locator('[data-testid="character-behavior"] > summary').click();
  await page.evaluate(async () => {
    const result = await window.__seedlandsHarness!.world.clock({ kind: 'run' });
    if (!result.ok) throw new Error('Life clock did not start');
  });
  return character;
}

export async function lifeSample(page: Page, entityId: string, sinceCursor: number) {
  return page.evaluate(
    async ({ id, cursor }) => {
      const harness = window.__seedlandsHarness!;
      const observation = await harness.world.character({ kind: 'observe', entityId: id, sinceCursor: cursor });
      const clock = await harness.world.clock({ kind: 'status' });
      const playerState = await harness.world.command({ type: 'query-player-state' });
      if (!observation.ok || observation.data.kind !== 'observation' || !clock.ok)
        throw new Error(`Life observation unavailable: ${JSON.stringify({ observation, clock })}`);
      const snapshot = harness.snapshot();
      if (!snapshot) throw new Error('Product snapshot unavailable');
      const player =
        playerState.ok && playerState.data.success
          ? (playerState.data.data as { player?: PlayerSnapshot } | undefined)?.player
          : undefined;
      if (!player) throw new Error('Player state unavailable');
      return {
        player,
        observation: observation.data.observation,
        worldTime: clock.data.snapshot.worldTime,
        physicsTick: clock.data.snapshot.physicsTick,
        simulationTime: clock.data.snapshot.activeTimeMs / 1000,
        paused: clock.data.paused,
      };
    },
    { id: entityId, cursor: sinceCursor },
  );
}

export async function faceLifeCharacter(page: Page, entityId: string) {
  await page.evaluate(async (id) => {
    const harness = window.__seedlandsHarness!;
    const result = await harness.world.character({ kind: 'observe', entityId: id });
    const snapshot = harness.snapshot();
    if (!result.ok || result.data.kind !== 'observation' || !snapshot) throw new Error('Body unavailable');
    const [x, y, z] = result.data.observation.self.position;
    const [px, py, pz] = snapshot.player;
    harness.setView(
      (Math.atan2(px - x, pz - z) * 180) / Math.PI,
      (Math.atan2(y + 1 - py, Math.hypot(x - px, z - pz)) * 180) / Math.PI,
    );
    // Let the client consume a fresh pose and actually render the new camera before capture.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, entityId);
}

export class LifeEvidence {
  constructor(private readonly homePosition: CharacterPosition = lifeScene.homePosition) {}

  feedingEpisodes = 0;
  nightDayEpisodes = 0;
  patrolArrivals = 0;
  private restedAtNight = false;
  private lastCursor = 0;
  readonly actions = new Map<string, number>();

  record(sample: Awaited<ReturnType<typeof lifeSample>>) {
    const { observation, worldTime } = sample;
    const { character, self } = observation;
    if (sample.player.lifecycle !== 'alive') throw new Error('Player died');
    if (character.lifecycle !== 'active' || (self.health ?? 1) <= 0) throw new Error('Character died');
    if (observation.gap || observation.cursor < this.lastCursor) throw new Error('Life event coverage lost');
    const newEvents = observation.events.filter((event) => event.cursor > this.lastCursor);
    this.lastCursor = observation.cursor;
    const skills = character.behaviorTree.runtime.skills;
    this.feedingEpisodes += newEvents.filter(
      (event) =>
        event.type === 'activity-succeeded' &&
        event.nodeId === 'hunger-action' &&
        event.hunger !== undefined &&
        event.hunger <= 20,
    ).length;
    const distance = (position: CharacterPosition) => Math.hypot(...position.map((v, i) => v - self.position[i]));
    const night = worldTime >= 18 || worldTime < 6;
    if (
      night &&
      distance(this.homePosition) <= CHARACTER_ARRIVAL_RADIUS &&
      skills.some((s) => s.skill === 'rest-at-home' && s.status === 'running' && s.phase === 'resting')
    )
      this.restedAtNight = true;
    const arrivals = newEvents.filter((event) => event.type === 'activity-succeeded' && event.nodeId === 'day-patrol');
    this.patrolArrivals += arrivals.length;
    if (!night && arrivals.length && this.restedAtNight) {
      this.nightDayEpisodes++;
      this.restedAtNight = false;
    }
    for (const skill of skills)
      if (skill.actionId && skill.status === 'running')
        this.actions.set(skill.actionId, (this.actions.get(skill.actionId) ?? 0) + 1);
  }
}
