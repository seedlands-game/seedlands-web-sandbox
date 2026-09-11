import { describe, expect, it } from 'vitest';

import { BEHAVIOR_MAX_OPERATION_ID_LENGTH } from '@seedlands/game-core/runtime/behavior-control-protocol';
import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  defineBehaviorCapabilityModule,
  defineBehaviorRegistryModule,
  definePack,
  type BehaviorCapabilityRegistry,
  type BehaviorProviderDefinition,
  type ModModule,
} from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  OVERWORLD_PRODUCT_PERMISSIONS,
  type ModuleActorAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { WorldResourceAuthorizer } from '../../packages/game-core/src/server/harness/world-authorization';
import { verifiedBehaviorPack } from '../support/behavior-capability-fixtures';
import { testCorePlatform } from '../support/core-platform';

const operationIdAtLimit = `example:${'x'.repeat(BEHAVIOR_MAX_OPERATION_ID_LENGTH - 'example:'.length)}`;

const operationModule: ModModule = {
  descriptor: {
    id: 'example:operation-module',
    version: '1.0.0',
    resources: [{ id: 'example.work', operations: ['execute'] }],
    permissions: [{ resource: 'example.work', operations: ['execute'] }],
  },
  register(api) {
    api.registerOperation({
      id: 'example:work',
      resource: 'example.work',
      run: () => ({ completed: true }),
    });
    api.registerOperation({
      id: 'example:system-work',
      executionKind: 'system',
      resource: 'example.work',
      run: () => ({ completed: true }),
    });
    api.registerOperation({
      id: operationIdAtLimit,
      resource: 'example.work',
      run: () => ({ completed: true }),
    });
  },
};

const requiredSkill = (operationId = 'example:work') =>
  ({
    kind: 'skill',
    id: 'example:required-skill',
    version: '1.0.0',
    description: 'Requires a host-authorized operation.',
    arguments: {},
    requiredOperations: [{ operationId, authorization: 'self' }],
    state: { version: '1.0.0', maximumBytes: 32 },
    start: () => ({ status: 'succeeded', phase: 'done' }),
    continue: () => ({ status: 'failed', reason: 'unexpected' }),
  }) as unknown as BehaviorProviderDefinition;

const compositionWith = (
  capabilities: readonly BehaviorProviderDefinition[],
  grantBehavior: boolean,
  grantOperationOwner = true,
) => {
  const operations = grantOperationOwner
    ? operationModule
    : {
        ...operationModule,
        descriptor: { ...operationModule.descriptor, permissions: [] },
      };
  const behavior = defineBehaviorCapabilityModule({
    id: 'example:behavior-module',
    version: '1.0.0',
    permissions: grantBehavior ? [{ resource: 'example.work', operations: ['execute'] }] : [],
    capabilities,
  });
  const extension = definePack({
    id: 'example:behavior-pack',
    version: '1.0.0',
    kind: 'extension',
    dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
    modules: [operations, behavior],
  });
  return assembleWorldPacks([verifiedBehaviorPack(overworld), verifiedBehaviorPack(extension)], {
    approvedPermissions: {
      'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS,
      'example:behavior-pack': [
        ...(grantOperationOwner ? operationModule.descriptor.permissions! : []),
        ...(grantBehavior ? behavior.descriptor.permissions! : []),
      ],
    },
  });
};

const permissiveActorAuthority = (resources: ReturnType<typeof compositionWith>['resources']): ModuleActorAuthority => {
  const forActor: ModuleActorAuthority['forActor'] = (actorId, kind) => {
    if (kind !== 'player' && kind !== 'npc' && kind !== 'creature') return undefined;
    const principalId = `test:${kind}:${actorId}`;
    return {
      principalId,
      authorizer: new WorldResourceAuthorizer(
        {
          principals: [{ id: principalId, kind: 'actor', subject: principalId, boundEntityId: actorId }],
          rules: [{ effect: 'allow', principal: { ids: [principalId] }, resources: ['*'], operations: ['*'] }],
        },
        resources,
      ),
    };
  };
  return { forActor, resolveOrigin: (origin, kind) => forActor(origin.originalActor.entityId, kind) };
};

describe('behavior capability admission', () => {
  it('rejects missing definitions or frozen owner/provider grants before publishing a catalog', () => {
    expect(() => compositionWith([requiredSkill('example:missing')], true)).toThrow(/required operation|missing/i);
    expect(() => compositionWith([requiredSkill()], false)).toThrow(/required operation|permission|grant/i);
    expect(() => compositionWith([requiredSkill()], true, false)).toThrow(/operation owner|permission|grant/i);
    expect(() => compositionWith([requiredSkill('example:system-work')], true)).toThrow(/actor-executable/i);
  });

  it('publishes a 160-character required operation id but rejects 161 characters in the core contract', () => {
    const composition = compositionWith([requiredSkill(operationIdAtLimit)], true);
    const registry = composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY);
    expect(registry.catalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'example:required-skill',
          requiredOperations: [{ operationId: operationIdAtLimit, authorization: 'self' }],
        }),
      ]),
    );
    expect(() => compositionWith([requiredSkill(`${operationIdAtLimit}x`)], true)).toThrow(
      /required operation is invalid/i,
    );
  });

  it('uses one global capability id namespace across conditions and skills', () => {
    const duplicate = 'example:duplicate';
    const condition = {
      kind: 'condition' as const,
      id: duplicate,
      version: '1.0.0',
      description: 'Condition side of a cross-kind collision.',
      arguments: {},
      evaluate: () => true,
    };
    const skill = { ...requiredSkill(), id: duplicate } as BehaviorProviderDefinition;
    expect(() => compositionWith([condition, skill], true)).toThrow(/duplicate behavior capability/i);
  });

  it('filters an otherwise valid actor catalog through the current host authorization gate', () => {
    const composition = compositionWith([requiredSkill()], true);
    const registry = composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY);
    const actor = { entityId: 'npc-1', epoch: 1, lifetime: 1 };
    const state = {
      reference: actor,
      lifecycle: 'alive' as const,
      controlSource: 'behavior' as const,
      health: 20,
      maxHealth: 20,
      needs: { hunger: 60, maxHunger: 100, hungerMeaning: 'deficit' as const },
      inventory: { slots: [], selectedSlot: 0, revision: 0 },
    };
    const actorCatalog = registry.catalogForActor as unknown as (
      binding: typeof actor,
      actorState: typeof state,
      allowed: (capability: unknown) => boolean,
    ) => ReturnType<BehaviorCapabilityRegistry['catalog']>;
    expect(actorCatalog(actor, state, () => false)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'example:required-skill' })]),
    );
  });

  it('keeps a bare world valid but rejects a behavior registry whose standard operation dependencies are absent', () => {
    const bare = definePack({ id: 'example:bare', version: '1.0.0', kind: 'playbook' });
    expect(() => assembleWorldPacks([verifiedBehaviorPack(bare)])).not.toThrow();
    const behaviorOnly = definePack({
      id: 'example:behavior-only',
      version: '1.0.0',
      kind: 'playbook',
      modules: [defineBehaviorRegistryModule()],
    });
    expect(() => assembleWorldPacks([verifiedBehaviorPack(behaviorOnly)])).toThrow(
      /required operation|missing|permission/i,
    );
    const noCombat = definePack({
      id: 'example:no-combat',
      version: '1.0.0',
      kind: 'playbook',
      modules: overworld.modules.filter(
        ({ descriptor }) =>
          descriptor.id !== 'seedlands:combat-module' && descriptor.id !== 'seedlands:overworld-combat-rules',
      ),
    });
    expect(() =>
      assembleWorldPacks([verifiedBehaviorPack(noCombat)], {
        approvedPermissions: { 'example:no-combat': OVERWORLD_PRODUCT_PERMISSIONS },
      }),
    ).toThrow(/combat|unknown resource|required operation/i);
  });

  it('rejects an actor-unavailable skill before birth mutates the world and filters it from actor discovery', async () => {
    const composition = compositionWith([requiredSkill()], true);
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'behavior-actor-admission',
      createComposition: () => composition,
    });
    try {
      await session.world.clock({ kind: 'pause' });
      const before = await session.world.checkpoint({ kind: 'export' });
      expect(before.ok).toBe(true);
      const rejected = await session.world.character({
        kind: 'create',
        creationRequestId: 'unavailable-operation',
        profile: { name: 'Blocked', personality: 'Careful' },
        position: [1.5, 34, 0.5],
        behaviorTree: {
          goal: { description: 'Try unavailable work.' },
          definition: { version: 1, root: { id: 'work', type: 'action', skill: 'example:required-skill' } },
        },
      });
      expect(rejected).toMatchObject({ ok: false });
      const after = await session.world.checkpoint({ kind: 'export' });
      expect(after).toEqual(before);

      const created = await session.world.character({
        kind: 'create',
        creationRequestId: 'ordinary-life',
        profile: { name: 'Allowed', personality: 'Careful' },
        position: [1.5, 34, 0.5],
      });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Expected a valid default character.');
      const catalog = await session.world.character({
        kind: 'capabilities',
        entityId: created.data.character.entityId,
      });
      expect(catalog).toMatchObject({ ok: true, data: { kind: 'capabilities' } });
      if (!catalog.ok || catalog.data.kind !== 'capabilities') throw new Error('Expected an actor catalog.');
      expect(catalog.data.capabilities.some(({ id }) => id === 'example:required-skill')).toBe(false);
      const installed = session.runtime.server.freezeSaveSnapshot(0);
      expect(
        await session.world.character({
          kind: 'behavior',
          entityId: created.data.character.entityId,
          requestId: 'unavailable-update',
          expectedBehaviorRevision: 1,
          goal: { description: 'Try unavailable work after birth.' },
          definition: { version: 1, root: { id: 'work', type: 'action', skill: 'example:required-skill' } },
        }),
      ).toMatchObject({ ok: false });
      expect(session.runtime.server.freezeSaveSnapshot(0)).toEqual(installed);
    } finally {
      await session.dispose();
    }
  });

  it('rejects restore atomically when the current actor grant no longer admits a required operation', async () => {
    const composition = compositionWith([requiredSkill()], true);
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const allowed = new GameServer({
      platform: testCorePlatform,
      seedText: 'behavior-restore-admission',
      persistence,
      composition,
      moduleActorAuthority: permissiveActorAuthority(composition.resources),
      moduleSystemAuthority: createGameplaySystemAuthority(composition),
    });
    allowed.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    expect(
      allowed.character({
        kind: 'create',
        profile: { name: 'Worker', personality: 'Persistent' },
        position: [1.5, 34, 0.5],
        behaviorTree: {
          goal: { description: 'Use the admitted operation.' },
          definition: { version: 1, root: { id: 'work', type: 'action', skill: 'example:required-skill' } },
        },
      }),
    ).toMatchObject({ kind: 'created' });
    await allowed.save();

    const denied = new GameServer({
      platform: testCorePlatform,
      seedText: 'behavior-restore-admission',
      persistence,
      composition,
      moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'player' }),
      moduleSystemAuthority: createGameplaySystemAuthority(composition),
    });
    const before = denied.freezeSaveSnapshot(0);
    await expect(denied.restore()).rejects.toThrow(/capability is unavailable|example:required-skill/i);
    expect(denied.freezeSaveSnapshot(0)).toEqual(before);
  });
});
