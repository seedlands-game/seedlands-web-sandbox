import { expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/stdlib/server/headless/headless-session';
import { CHARACTER_ARRIVAL_RADIUS } from '@seedlands/stdlib/runtime/character-control-protocol';
import { createCharacterComposition } from '../../../fixtures/classic/character-gameplay';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';

it('routes a behavior actor around two nearby real bodies without moving or disabling those bodies', async () => {
  const session = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'three-resident-body-obstacle',
    createComposition: createCharacterComposition,
    initialWorldTime: 10,
  });
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
      { type: 'teleport', position: [-10.5, 57, 10.5] },
    ] as const)
      expect(await session.world.command(command)).toMatchObject({ ok: true, data: { success: true } });
    // From the first failed real-model journey: the mover touches the first settler's AABB.
    const stationary = [
      [-3.065213865788356, 57, -4.5],
      [-4.5, 57, -2.5],
    ] as const;
    const blockers: string[] = [];
    for (const position of stationary) {
      const born = await session.world.character({
        kind: 'create',
        position,
        profile: { name: `Waiting ${blockers.length}`, personality: 'Wait for a friend.' },
        behaviorTree: {
          goal: { description: 'Remain at this position.' },
          definition: { version: 1, root: { id: 'stay', type: 'action', skill: 'hold' } },
        },
      });
      if (!born.ok || born.data.kind !== 'created') throw new Error('Blocker creation failed');
      blockers.push(born.data.character.entityId);
    }
    const destination = [-3.5, 57, 4.5] as const;
    const born = await session.world.character({
      kind: 'create',
      position: [-1.765213865788356, 57, -4.5],
      profile: { name: 'Camp visitor', personality: 'Meet a friend at camp.' },
      behaviorTree: {
        goal: { description: 'Reach camp, then wait.' },
        definition: {
          version: 1,
          root: {
            id: 'visit',
            type: 'sequence',
            children: [
              { id: 'walk', type: 'action', skill: 'move-to', args: { position: [...destination], maxReplans: 12 } },
              { id: 'wait', type: 'action', skill: 'wait', args: { seconds: 30 } },
            ],
          },
        },
      },
    });
    if (!born.ok || born.data.kind !== 'created') throw new Error('Mover creation failed');
    const entityId = born.data.character.entityId;
    for (let second = 0; second < 30; second++) {
      const advanced = await session.world.clock({ kind: 'advance', elapsedMs: 1000 });
      expect(advanced, JSON.stringify(advanced)).toMatchObject({ ok: true });
    }
    const observed = await session.world.character({ kind: 'observe', entityId });
    if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Mover observation failed');
    expect(observed.data.observation.character.lifecycle).toBe('active');
    expect(
      Math.hypot(...observed.data.observation.self.position.map((value, axis) => value - destination[axis])),
    ).toBeLessThanOrEqual(CHARACTER_ARRIVAL_RADIUS);
    expect(observed.data.observation.events).toContainEqual(
      expect.objectContaining({ nodeId: 'walk', type: 'activity-succeeded' }),
    );
    for (const [index, id] of blockers.entries()) {
      const position = session.runtime.server.getEntity(id)?.position;
      expect(position).toBeDefined();
      position!.forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(stationary[index][axis], 5));
    }
  } finally {
    await session.dispose();
  }
}, 30000);
