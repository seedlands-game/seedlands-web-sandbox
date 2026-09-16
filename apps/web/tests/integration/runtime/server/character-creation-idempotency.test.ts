import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeadlessSession } from '@seedlands/stdlib/server/headless/headless-session';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { createCharacterComposition } from '../../../fixtures/classic/character-gameplay';

describe('character creation receipt identity', () => {
  let session: HeadlessSession;
  beforeEach(async () => {
    session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'creation-receipt',
      createComposition: createCharacterComposition,
    });
  }, 5_000);
  afterEach(async () => {
    await session?.dispose();
  }, 5_000);

  it('reuses one identity across retries and checkpoint restore, rejecting changed payload', async () => {
    await session.world.clock({ kind: 'pause' });
    const request = {
      kind: 'create',
      creationRequestId: 'birth-fixed',
      profile: { name: '阿岚', personality: '好奇' },
    } as const;
    const created = await session.world.character(request);
    expect(created.ok).toBe(true);
    if (!created.ok || created.data.kind !== 'created') throw new Error('creation failed');
    const id = created.data.character.entityId;
    expect(await session.world.character(request)).toMatchObject({
      ok: true,
      data: { kind: 'created', character: { entityId: id } },
    });
    expect(
      await session.world.character({ ...request, profile: { name: '其他人', personality: '好奇' } }),
    ).toMatchObject({ ok: false });
    const checkpoint = await session.world.checkpoint({ kind: 'export' });
    if (!checkpoint.ok) throw new Error('checkpoint failed');
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(await session.world.character(request)).toMatchObject({
      ok: true,
      data: { kind: 'created', character: { entityId: id } },
    });
    const listed = await session.world.character({ kind: 'list' });
    if (!listed.ok || listed.data.kind !== 'list') throw new Error('list failed');
    expect(listed.data.characters).toHaveLength(1);
  });
});
