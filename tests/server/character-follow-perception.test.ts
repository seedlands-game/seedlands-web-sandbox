import { expect, it } from 'vitest';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { testCorePlatform } from '../support/core-platform';

it('reacquires a previously observed follow target through local perception without another decision', async () => {
  const session = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'follow-reacquire',
    initialWorldTime: 10,
  });
  try {
    await session.world.clock({ kind: 'pause' });
    for (const box of [
      { from: [-30, 56, -4], to: [30, 56, 4], voxel: 1 },
      { from: [-30, 57, -4], to: [30, 61, 4], voxel: 0 },
    ])
      expect(
        await session.world.command({ type: 'fill', ...box } as unknown as Parameters<typeof session.world.command>[0]),
      ).toMatchObject({ ok: true });
    await session.world.command({ type: 'teleport', position: [4.5, 57, 0.5] });
    const created = await session.world.character({
      kind: 'create',
      profile: { name: 'Lin', personality: 'Curious.' },
      position: [0.5, 57, 0.5],
      behaviorTree: {
        goal: { description: 'Wait.' },
        definition: { version: 1, root: { id: 'wait', type: 'action', skill: 'hold' } },
      },
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('create failed');
    const entityId = created.data.character.entityId;
    const read = async () => {
      const result = await session.world.character({ kind: 'observe', entityId });
      if (!result.ok || result.data.kind !== 'observation') throw new Error('observe failed');
      return result.data.observation;
    };
    const target = (await read()).visibleEntities.find((entry) => entry.type === 'player')?.target;
    expect(target).toBeDefined();
    await session.world.command({ type: 'teleport', position: [28.5, 57, 0.5] });
    const proposal = {
      goal: { description: 'Follow the person I saw.' },
      definition: {
        version: 1 as const,
        root: {
          id: 'follow-person',
          type: 'action' as const,
          skill: 'follow' as const,
          args: { targetRef: target!.ref },
        },
      },
    };
    expect(
      await session.world.character({
        kind: 'behavior',
        entityId,
        requestId: 'follow',
        expectedBehaviorRevision: 1,
        ...proposal,
      }),
    ).toMatchObject({ ok: true });
    await session.world.clock({ kind: 'advance', elapsedMs: 1000 });
    expect((await read()).character.behaviorTree.runtime.skills).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'target-unavailable', status: 'failed' })]),
    );
    await session.world.command({ type: 'teleport', position: [5.5, 57, 0.5] });
    const before = await read();
    await session.world.clock({ kind: 'advance', elapsedMs: 3000 });
    const after = await read();
    expect(after.character.behaviorTree.revision).toBe(2);
    expect(after.character.behaviorTree.definition).toEqual(proposal.definition);
    expect(after.character.behaviorTree.runtime.skills).toEqual(
      expect.arrayContaining([expect.objectContaining({ skill: 'follow', status: 'running' })]),
    );
    expect(after.self.position[0]).toBeGreaterThan(before.self.position[0] + 1);
  } finally {
    await session.dispose();
  }
}, 30000);
