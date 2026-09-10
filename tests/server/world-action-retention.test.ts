import { expect, it, onTestFinished } from 'vitest';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { testCorePlatform } from '../support/core-platform';

it('bounds command-created action history across Harness query and portable checkpoint restore', async () => {
  const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'action-history-harness' });
  onTestFinished(() => session.dispose());
  expect(await session.world.clock({ kind: 'pause' })).toMatchObject({ ok: true });
  expect(
    await session.world.command({ type: 'spawn-actor', id: 'actor', archetype: 'settler', position: [3, 30, 3] }),
  ).toMatchObject({ ok: true, data: { success: true } });
  let firstId = '';
  for (let index = 0; index < 320; index += 1) {
    expect(await session.world.command({ type: 'start-action', entityId: 'actor', action: 'idle' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    if (index === 0) firstId = session.runtime.server.getActorAction('actor')!.id;
  }
  const current = session.runtime.server.getActorAction('actor')!;
  const query = await session.world.actions();
  if (!query.ok) throw new Error(query.error.message);
  expect(query.data.actions).toHaveLength(257);
  expect(await session.world.actions({ actionId: firstId })).toMatchObject({
    ok: false,
    error: { code: 'WORLD_PERMISSION_DENIED' },
  });
  expect(await session.world.actions({ entityId: 'actor', actionId: current.id })).toMatchObject({
    ok: true,
    data: { actions: [current] },
  });
  const checkpoint = await session.world.checkpoint({ kind: 'export' });
  if (!checkpoint.ok) throw new Error(checkpoint.error.message);
  expect(await session.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
    ok: true,
  });
  expect(await session.world.actions({ actionId: current.id })).toMatchObject({
    ok: true,
    data: { actions: [current] },
  });
  expect(await session.world.command({ type: 'start-action', entityId: 'actor', action: 'idle' })).toMatchObject({
    ok: true,
    data: { success: true },
  });
  expect(session.runtime.server.getActorAction('actor')!.id).not.toBe(current.id);
}, 30_000);
