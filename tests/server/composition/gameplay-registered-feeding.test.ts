import { expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { executeGameplayCommand } from '../../../packages/game-core/src/server/commands/gameplay-command-handler';
import { bindModuleCommandPort } from '../../../packages/game-core/src/server/commands/module-command';
import { GameServer } from '../../../packages/game-core/src/server/game-server';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { defineFeedingActionsModule } from '../../../packages/game-core/src/server/gameplay/modules/feeding-actions-module';
import { defineFeedingRulesModule } from '../../../packages/game-core/src/server/gameplay/modules/feeding-rules-module';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { testCorePlatform } from '../../support/core-platform';

function setup(
  options: {
    provider?: boolean;
    denyActorExecute?: boolean;
    moduleActorExecute?: boolean;
    allow?: boolean;
    veto?: boolean;
    count?: number;
    cloneHook?: (value: unknown) => void;
  } = {},
) {
  const extra: ModModule = {
    descriptor: {
      id: 'test:feeding-veto',
      version: '1.0.0',
      requires: [{ id: 'seedlands:feeding', version: '1.0.0' }],
      permissions: [{ resource: 'seedlands.feeding-item', operations: ['read', 'execute'] }],
    },
    register(api) {
      api.registerRule({
        id: 'test:feeding-veto/after',
        operationId: 'seedlands:consume-world-item',
        stage: 'after',
        apply: () => ({ reject: 'feeding-veto' }),
      });
    },
  };
  const modules = [
    ...pack.modules.filter((module) => !module.descriptor.id.includes('feeding')),
    ...(options.provider === false
      ? []
      : [
          (() => {
            const module = defineFeedingActionsModule();
            return options.moduleActorExecute === false
              ? {
                  ...module,
                  descriptor: {
                    ...module.descriptor,
                    permissions: module.descriptor.permissions?.map((permission) =>
                      permission.resource === 'seedlands.feeding-actor'
                        ? { ...permission, operations: ['read' as const] }
                        : permission,
                    ),
                  },
                }
              : module;
          })(),
          defineFeedingRulesModule({
            moduleId: 'test:feeding-rules',
            eligibleArchetypes: ['grazer'],
            deficitThreshold: 50,
            restore: 'full',
          }),
        ]),
    ...(options.veto ? [extra] : []),
  ];
  const root = definePack({ id: 'test:feeding-world', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...root,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:feeding-world': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'script', subject: 'test:feeding-script', boundEntityId: 'grazer', kind: 'actor' }],
      rules:
        options.allow === false
          ? []
          : [
              ...(options.denyActorExecute
                ? [
                    {
                      effect: 'deny' as const,
                      resources: ['seedlands.feeding-actor'],
                      operations: ['execute' as const],
                      scope: 'any' as const,
                    },
                  ]
                : []),
              {
                effect: 'allow',
                resources: ['seedlands.feeding-actor', 'seedlands.feeding-item'],
                operations: ['read', 'execute'],
                scope: 'any',
              },
            ],
    },
    composition.resources,
  );
  let checkpoint: ReturnType<GameServer['freezePortableSaveSnapshot']>['gameplay'] | null = null;
  const server = new GameServer({
    persistence: { loadSnapshot: () => null, saveSnapshots: () => {}, loadGameplaySnapshot: async () => checkpoint },
    seedText: 'registered-feeding',
    composition,
    platform: {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        options.cloneHook?.(value);
        return structuredClone(value);
      },
    },
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, {
      playerAlias: 'test:player',
      scriptAuthorization: authorizer,
    }),
  });
  server.editBatch({ actorId: 'fixture', edits: [0, 1, 2, 3].map((x) => ({ x, y: 60, z: 0, value: 0 })) });
  server.spawnPlayer({ id: 'player', position: [3.5, 60, 0.5] });
  server.spawnAutonomousActor({
    id: 'grazer',
    archetype: 'grazer',
    position: [0.5, 60, 0.5],
    registration: { hunger: 60 },
  });
  const food = server.spawnWorldItem([1.2, 60, 0.5], { itemId: 'berry', count: options.count ?? 2 });
  return {
    server,
    food,
    binding: { authorizer, principalId: 'script' },
    restore: async (saved: NonNullable<typeof checkpoint>) => {
      checkpoint = saved;
      await server.restore();
    },
    eat: () =>
      server.applyActorAuthorityAction(
        'grazer',
        { type: 'consume-world-item', targetId: food.id },
        { authorizer, principalId: 'script' },
      ),
  };
}
const snapshot = (server: GameServer) => server.freezePortableSaveSnapshot(0);

it.each([{ provider: false }, { allow: false }, { veto: true }])(
  'rejects unavailable, denied or vetoed Feeding without owner changes: %j',
  (options) => {
    const { server, eat } = setup(options);
    const before = snapshot(server);
    expect(eat()).toMatchObject({ accepted: false, changed: false });
    expect(snapshot(server)).toEqual(before);
  },
);

it.each([1, 2])('consumes one ground food with prepared needs and completed Eat action (stack %s)', (count) => {
  const { server, food, eat } = setup({ count });
  const reference = server.createEntityReference(food.id);
  expect(eat()).toMatchObject({ accepted: true, changed: true, action: { type: 'eat', status: 'succeeded' } });
  expect(server.getActorState('grazer')).toMatchObject({ hunger: 0, behavior: 'idle', targetEntityId: null });
  if (count === 1) expect(server.getEntity(food.id)).toBeNull();
  else {
    expect(server.getEntity(food.id)).toMatchObject({ stack: { itemId: 'berry', count: 1 } });
    expect(server.createEntityReference(food.id)).toEqual(reference);
  }
  const after = snapshot(server);
  expect(eat()).toMatchObject({ accepted: false, changed: false });
  expect(snapshot(server)).toEqual(after);
});

it('does not commit food, needs or Eat history when final result clone fails', () => {
  let armed = false;
  const { server, eat } = setup({
    cloneHook: (value) => {
      if (armed && value && typeof value === 'object' && 'success' in value && 'consumedEntityId' in value)
        throw new Error('feeding-clone-failure');
    },
  });
  const before = snapshot(server);
  armed = true;
  expect(eat()).toMatchObject({ accepted: false, changed: false });
  armed = false;
  expect(snapshot(server)).toEqual(before);
});

it('cancels legacy pending Eat at composed restore without spending food or hunger', async () => {
  const { server, food, restore } = setup();
  const pending = server.startActorAction('grazer', { type: 'eat', targetEntityId: food.id });
  const saved = snapshot(server).gameplay;
  await restore(saved);
  const normalized = snapshot(server).gameplay;
  expect(normalized.entityStore).toEqual(saved.entityStore);
  expect(normalized.simulation.actions.actions.find((entry) => entry.id === pending.id)).toMatchObject({
    status: 'interrupted',
    reason: 'restore-cancelled',
  });
});

it.each([false, true])('start-action/eat uses the actual module binding (allowed: %s)', async (allow) => {
  const { server, food, binding } = setup({ allow });
  const before = snapshot(server);
  const request = executeGameplayCommand(
    server,
    { actorId: 'script', sourceType: 'developer', entityId: 'grazer', capabilities: [] },
    {
      type: 'start-action',
      action: 'eat',
      targetEntityId: food.id,
    },
    bindModuleCommandPort(server, binding),
  );
  if (allow) {
    await expect(request).resolves.toMatchObject({
      data: { success: true, action: { type: 'eat', status: 'succeeded' } },
    });
    expect(server.getActorAction('grazer')).toBeNull();
    expect(server.getEntity(food.id)?.stack?.count).toBe(1);
  } else {
    await expect(request).rejects.toThrow(/DENIED/);
    expect(snapshot(server)).toEqual(before);
  }
});

it.each(['revision', 'action-sequence'])('preserves all Feeding owners on exhausted %s', async (capacity) => {
  const { server, eat, restore } = setup();
  const saved = snapshot(server).gameplay;
  if (capacity === 'revision') saved.revision = Number.MAX_SAFE_INTEGER;
  else saved.simulation.actions.sequence = Number.MAX_SAFE_INTEGER;
  await restore(saved);
  const before = snapshot(server);
  expect(eat()).toMatchObject({ accepted: false, changed: false });
  expect(snapshot(server)).toEqual(before);
});

it('rejects food behind a wall before modifying any owner', () => {
  const { server, food, eat } = setup();
  server.updateEntity('grazer', { position: [0.95, 60, 0.5] });
  server.updateEntity(food.id, { position: [2.02, 60, 0.5] });
  server.editBatch({ actorId: 'fixture', edits: [{ x: 1, y: 60, z: 0, value: 3 }] });
  const before = snapshot(server);
  expect(eat()).toMatchObject({ accepted: false, changed: false });
  expect(snapshot(server)).toEqual(before);
});

it.each([{ denyActorExecute: true }, { moduleActorExecute: false }])(
  'requires actor execute for principal and module in addition to item execute: %j',
  (options) => {
    const { server, food, eat } = setup(options);
    const before = snapshot(server),
      reference = server.createEntityReference(food.id);
    expect(eat()).toMatchObject({ accepted: false, changed: false });
    expect(snapshot(server)).toEqual(before);
    expect(server.createEntityReference(food.id)).toEqual(reference);
  },
);
