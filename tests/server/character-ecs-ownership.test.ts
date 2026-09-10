import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../support/core-platform';

const callbacks = {
  platform: testCorePlatform,
  getVoxel: () => 0,
  getWorldTime: () => 12,
  prepareVoxelEdit: () => {
    throw new Error('unused');
  },
} as const;

function createComposedRuntime() {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256' as const,
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  return new GameplayRuntime({
    ...callbacks,
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
  });
}

describe('Character ECS ownership', () => {
  it('keeps the behavior module optional and rolls back an unavailable create', () => {
    const runtime = new GameplayRuntime(callbacks);

    expect(() =>
      runtime.character({
        kind: 'create',
        profile: { name: '未装载角色', personality: '不应创建身体。' },
        position: [1.5, 2, 0.5],
      }),
    ).toThrow(/behavior module is unavailable/i);
    expect(runtime.queryEntities({ type: 'npc' })).toEqual([]);
  });

  it('binds discovery and mutable behavior to the current ECS actor lifetime', () => {
    const runtime = createComposedRuntime();
    const created = runtime.character({
      kind: 'create',
      profile: { name: '林', personality: '谨慎、务实。' },
      position: [1.5, 2, 0.5],
    });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    const reference = runtime.entities.createReference(entityId);
    if (!reference) throw new Error('Character reference is unavailable.');
    const component = runtime.entities.bindActorCharacterComponent(entityId);
    if (!component) throw new Error('Character ECS component is unavailable.');

    expect(runtime.entities.actorComponentSnapshot(entityId)).toMatchObject({
      controlSource: 'behavior',
      controlRevision: 1,
      character: { entityId, incarnation: created.character.incarnation },
    });
    expect(runtime.character({ kind: 'capabilities', entityId }, reference)).toMatchObject({
      kind: 'capabilities',
      capabilities: expect.arrayContaining([expect.objectContaining({ id: 'satisfy-hunger' })]),
    });
    expect(
      runtime.character({ kind: 'capabilities', entityId }, { ...reference, lifetime: reference.lifetime + 1 }),
    ).toEqual({ kind: 'capabilities', capabilities: [] });

    runtime.character({
      kind: 'intent',
      entityId,
      requestId: 'wait',
      expectedRevision: created.character.revision,
      goal: { kind: 'idle' },
    });
    expect(runtime.entities.bindActorCharacterComponent(entityId)).toBe(component);
    expect(component).toMatchObject({ revision: 1, currentGoal: { requestId: 'wait', goal: { kind: 'idle' } } });

    expect(runtime.despawnEntity(entityId)).toBe(true);
    expect(runtime.character({ kind: 'list' })).toMatchObject({
      kind: 'list',
      characters: [{ entityId, lifecycle: 'deceased', incarnation: created.character.incarnation }],
    });
    expect(runtime.character({ kind: 'capabilities', entityId }, reference)).toEqual({
      kind: 'capabilities',
      capabilities: [],
    });
  });
});
