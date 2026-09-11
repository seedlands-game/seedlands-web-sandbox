import { expect, it } from 'vitest';
import { definePack } from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { GameServer } from '../../../../fixtures/classic/content';
import { WorldResourceAuthorizer } from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

function setup(
  resource: 'seedlands.inventory' | 'seedlands.block-actor' | 'seedlands.combat',
  denial?: 'principal' | 'module',
) {
  const moduleId =
    resource === 'seedlands.inventory' ? 'seedlands:inventory-actions-module' : 'seedlands:block-actions-module';
  // This partial composition tests operation permissions, not dependent behavior providers.
  const modules = pack.modules
    .filter((module) => module.descriptor.id !== 'seedlands:behavior-registry-module')
    .map((module) =>
      module.descriptor.id === moduleId && denial === 'module'
        ? {
            ...module,
            descriptor: {
              ...module.descriptor,
              permissions: module.descriptor.permissions?.map((permission) =>
                permission.resource === resource
                  ? { ...permission, operations: permission.operations.filter((operation) => operation !== 'execute') }
                  : permission,
              ),
            },
          }
        : module,
    );
  const root = definePack({ id: 'test:secondary-grants', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...root,
        integrity: {
          algorithm: 'sha256',
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [],
        },
      },
    ],
    {
      approvedPermissions: {
        'test:secondary-grants': modules.flatMap((module) => module.descriptor.permissions ?? []),
      },
    },
  );
  const authorizer = (deny: boolean) =>
    new WorldResourceAuthorizer(
      {
        principals: [{ id: 'script', subject: 'test:secondary-script', kind: 'actor', boundEntityId: 'player' }],
        rules: [
          { effect: 'allow', resources: ['*'], operations: ['*'], scope: 'any' },
          ...(deny
            ? [
                {
                  effect: 'deny' as const,
                  resources: [resource],
                  operations: ['execute' as const],
                  scope: resource === 'seedlands.combat' ? ('self' as const) : ('any' as const),
                },
              ]
            : []),
        ],
      },
      composition.resources,
    );
  const initial = authorizer(denial === 'principal');
  const revoked = authorizer(true);
  let revoke = false;
  const authorities = (auth: WorldResourceAuthorizer) =>
    createGameplayActorAuthority(composition.resources, {
      playerAlias: 'local-player',
      scriptAuthorization: auth,
    });
  const authority = authorities(initial);
  const server = new GameServer({
    seedText: 'secondary-grants',
    platform: testCorePlatform,
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: {
      ...authority,
      resolveOrigin: (origin, kind) => authorities(revoke ? revoked : initial).resolveOrigin(origin, kind),
    },
  });
  server.editBatch({
    actorId: 'fixture',
    edits: [
      { x: 0, y: 60, z: 0, value: 0 },
      { x: 1, y: 60, z: 0, value: 0 },
      { x: 2, y: 60, z: 0, value: 4 },
    ],
  });
  server.spawnPlayer({ id: 'player', position: [0.5, 60, 0.5] });
  server.giveItem('player', { itemId: 'wood-block', count: 2 });
  const food = server.spawnWorldItem([1.2, 60, 0.5], { itemId: 'berry', count: 2 });
  server.spawnAutonomousActor({ id: 'target', archetype: 'night-stalker', position: [0.5, 60, 1.5] });
  const invoke = (operationId: string) =>
    server.invokeModuleOperation(
      initial,
      {
        principalId: 'script',
        originalActorId: 'player',
      },
      operationId === 'seedlands:request-combat'
        ? { operationId, target: { kind: 'entity', entityId: 'target' }, input: { targetId: 'target' } }
        : operationId === 'seedlands:inventory-pickup'
          ? {
              operationId,
              target: { kind: 'entity', entityId: food.id },
            }
          : {
              operationId,
              target: { kind: 'voxel', position: operationId === 'seedlands:block-place' ? [1, 60, 0] : [2, 60, 0] },
              input: { position: operationId === 'seedlands:block-place' ? [1, 60, 0] : [2, 60, 0] },
            },
    );
  return {
    server,
    food,
    invoke,
    revoke: () => {
      revoke = true;
    },
  };
}
const snapshot = (server: GameServer) => server.freezePortableSaveSnapshot();

it.each(['principal', 'module'] as const)('pickup requires secondary actor execute from %s', (denial) => {
  const { server, food, invoke } = setup('seedlands.inventory', denial);
  const before = snapshot(server),
    reference = server.createEntityReference(food.id);
  expect(invoke('seedlands:inventory-pickup')).toMatchObject({ ok: false });
  expect(snapshot(server)).toEqual(before);
  expect(server.createEntityReference(food.id)).toEqual(reference);
});

it.each(['principal', 'module'] as const)('place and begin-break require secondary actor execute from %s', (denial) => {
  const { server, invoke } = setup('seedlands.block-actor', denial);
  for (const operation of ['seedlands:block-place', 'seedlands:block-begin']) {
    const before = snapshot(server);
    expect(invoke(operation)).toMatchObject({ ok: false });
    expect(snapshot(server)).toEqual(before);
  }
});

it('delayed break does not spend or edit after only actor execute is revoked', () => {
  const { server, invoke, revoke } = setup('seedlands.block-actor');
  const began = invoke('seedlands:block-begin');
  expect(began, JSON.stringify(began)).toMatchObject({ ok: true });
  const inventory = server.getInventory('player'),
    entities = server.queryEntities();
  revoke();
  server.advanceGameplayRules(2);
  expect(server.getVoxel(2, 60, 0)).toBe(4);
  expect(server.getInventory('player')).toEqual(inventory);
  expect(server.queryEntities()).toEqual(entities);
});

it('Combat cannot create actor Actions when execute is allowed only on its target', () => {
  const { server, invoke } = setup('seedlands.combat', 'principal');
  const before = snapshot(server);
  expect(invoke('seedlands:request-combat')).toMatchObject({ ok: false });
  expect(snapshot(server)).toEqual(before);
});

it('Combat rechecks actor execute before delayed damage', () => {
  const { server, invoke, revoke } = setup('seedlands.combat');
  server.giveItem('player', { itemId: 'wood-sword', count: 1 });
  server.selectHotbarSlot('player', 1);
  const health = server.getEntity('target')!.health;
  expect(invoke('seedlands:request-combat')).toMatchObject({ ok: true });
  revoke();
  server.advanceGameplayRules(0.4);
  expect(server.getEntity('target')!.health).toBe(health);
});
