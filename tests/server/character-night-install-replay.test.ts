import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import {
  CHARACTER_ARRIVAL_RADIUS,
  createLifeBehavior,
  type CharacterBehaviorInput,
} from '@seedlands/game-core/runtime/character-control-protocol';
import { HeadlessSession } from '@seedlands/game-core/server/headless/headless-session';
import { createCharacterComposition } from '../support/character-gameplay';
import { testCorePlatform } from '../support/core-platform';

const lateNightTask = JSON.parse(
  readFileSync(
    new URL('../../changes/2026-09-10-npc-composable-baseline/fixtures/late-night-task-tree.json', import.meta.url),
    'utf8',
  ),
) as CharacterBehaviorInput;

const INITIAL_WORLD_TIME = 22.48;
const WORLD_HOURS_PER_SECOND = 0.04;
const HOME = [0.5, 57, -3.5] as const;
const CAMP = [-3.5, 57, 4.5] as const;
const START = [1.4211652738120608, 57, -4.500000960357263] as const;

it('keeps a late-night task resting, then reaches camp in its next daylight opportunity', async () => {
  const session = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'late-night-task-replay',
    createComposition: createCharacterComposition,
    initialWorldTime: INITIAL_WORLD_TIME,
  });
  const advanceSeconds = async (seconds: number) => {
    let remainingMs = seconds * 1_000;
    while (remainingMs > 0) {
      const elapsedMs = Math.min(remainingMs, 60_000);
      expect(await session.world.clock({ kind: 'advance', elapsedMs })).toMatchObject({ ok: true });
      remainingMs -= elapsedMs;
    }
  };
  try {
    await session.world.clock({ kind: 'pause' });
    for (const entity of session.runtime.server.queryEntities())
      if (entity.id !== session.runtime.playerId)
        expect(await session.world.command({ type: 'despawn-entity', entityId: entity.id })).toMatchObject({
          ok: true,
        });
    for (const command of [
      { type: 'fill', from: [-12, 56, -16], to: [12, 56, 12], voxel: 3 },
      { type: 'fill', from: [-12, 57, -16], to: [12, 65, 12], voxel: 0 },
      { type: 'teleport', position: [-10.5, 58.6, 10.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 64, position: [4.5, 57, -1.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 64, position: [3.5, 57, -3.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 64, position: [-2.5, 57, 2.5] },
      { type: 'spawn-world-item', itemId: 'berry', count: 64, position: [-4.5, 57, -2.5] },
    ] as const)
      expect(await session.world.command(command)).toMatchObject({ ok: true, data: { success: true } });

    for (const [index, position] of [
      [-2.697451007759563, 57, -0.8866031965710751],
      [3.508829791758143, 57, 3.195511320869852],
    ].entries()) {
      const blocker = await session.world.character({
        kind: 'create',
        profile: { name: `Night neighbor ${index}`, personality: 'Remain nearby.' },
        position: position as [number, number, number],
        behaviorTree: {
          goal: { description: 'Remain at this position.' },
          definition: { version: 1, root: { id: 'stay', type: 'action', skill: 'hold' } },
        },
      });
      expect(blocker).toMatchObject({ ok: true, data: { kind: 'created' } });
    }

    const created = await session.world.character({
      kind: 'create',
      profile: { name: 'Late camp watcher', personality: 'Keep promises without skipping nightly rest.' },
      position: START,
      homePosition: HOME,
      behaviorTree: createLifeBehavior({ homePosition: HOME, patrolPositions: [[-4.5, 57, -4.5]] }),
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character creation failed.');
    const entityId = created.data.character.entityId;
    const updated = await session.world.character({
      kind: 'behavior',
      entityId,
      requestId: 'late-night-camp-watch',
      expectedBehaviorRevision: 1,
      ...lateNightTask,
    });
    expect(updated).toMatchObject({
      ok: true,
      data: { kind: 'behavior', accepted: true, character: { behaviorTree: { revision: 2 } } },
    });
    const installed = await session.world.character({ kind: 'observe', entityId });
    if (!installed.ok || installed.data.kind !== 'observation') throw new Error('Installed behavior unavailable.');
    let cursor = installed.data.observation.cursor;

    await advanceSeconds(60);
    const afterNightWindow = await session.world.character({ kind: 'observe', entityId, sinceCursor: cursor });
    if (!afterNightWindow.ok || afterNightWindow.data.kind !== 'observation')
      throw new Error('Night observation unavailable.');
    cursor = afterNightWindow.data.observation.cursor;
    expect(afterNightWindow.data.observation.character.behaviorTree.runtime.skills).toContainEqual(
      expect.objectContaining({ nodeId: 'night-action', skill: 'rest-at-home', status: 'running', phase: 'resting' }),
    );
    expect(afterNightWindow.data.observation.events).not.toContainEqual(
      expect.objectContaining({ nodeId: 'camp-move' }),
    );

    const afterNightClock = await session.world.clock({ kind: 'status' });
    if (!afterNightClock.ok) throw new Error('Night clock unavailable.');
    expect(afterNightClock.data.snapshot.worldTime).toBeCloseTo(0.88, 5);
    const secondsUntilDay = (6 - afterNightClock.data.snapshot.worldTime) / WORLD_HOURS_PER_SECOND;
    await advanceSeconds(Math.ceil(secondsUntilDay));
    const daylight = await session.world.clock({ kind: 'status' });
    if (!daylight.ok) throw new Error('Daylight clock unavailable.');
    expect(daylight.data.snapshot.worldTime).toBeGreaterThanOrEqual(6);
    expect(daylight.data.snapshot.worldTime).toBeLessThan(18);

    let minimumCampDistance = Number.POSITIVE_INFINITY;
    const daylightEvents = [];
    for (let second = 0; second < 60; second++) {
      await advanceSeconds(1);
      const observed = await session.world.character({ kind: 'observe', entityId, sinceCursor: cursor });
      if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Daylight observation unavailable.');
      cursor = observed.data.observation.cursor;
      daylightEvents.push(...observed.data.observation.events);
      minimumCampDistance = Math.min(
        minimumCampDistance,
        Math.hypot(...observed.data.observation.self.position.map((value, axis) => value - CAMP[axis])),
      );
    }
    expect(minimumCampDistance).toBeLessThanOrEqual(CHARACTER_ARRIVAL_RADIUS);
    expect(daylightEvents).toContainEqual(expect.objectContaining({ type: 'activity-succeeded', nodeId: 'camp-move' }));
    expect(daylightEvents).toContainEqual(expect.objectContaining({ type: 'activity-succeeded', nodeId: 'camp-wait' }));
  } finally {
    await session.dispose();
  }
}, 45_000);
