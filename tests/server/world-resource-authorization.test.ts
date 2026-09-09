import { describe, expect, it } from 'vitest';
import {
  COMMAND_RESOURCE_DIRECTORY,
  WorldResourceAuthorizer,
  commandAuthorizationRequests,
  type WorldAuthorizationPolicy,
} from '../../packages/game-core/src/server/harness/world-authorization';
import type { ServerCommand } from '../../packages/game-core/src/server/commands/command-contract';

const policy: WorldAuthorizationPolicy = {
  principals: [
    { id: 'alice', labels: ['developer'], boundEntityId: 'player-1' },
    { id: 'bob', labels: ['developer'], boundEntityId: 'player-2' },
    { id: 'player', labels: ['player'], boundEntityId: 'player-1' },
  ],
  rules: [
    {
      effect: 'allow',
      principal: { ids: ['alice'] },
      resources: ['*'],
      operations: ['*'],
      scope: 'any',
    },
    {
      effect: 'allow',
      principal: { ids: ['player'] },
      resources: ['world.identity', 'world.entity', 'world.action'],
      operations: ['read', 'execute'],
      scope: 'self',
    },
  ],
};

describe('world resource authorization', () => {
  it('binds policy to trusted principal ids instead of caller labels', () => {
    const authorization = new WorldResourceAuthorizer(policy);
    const request = { resource: 'world.checkpoint', operation: 'export', target: { kind: 'world' } } as const;

    expect(authorization.authorize('alice', request)).toMatchObject({ allowed: true });
    expect(authorization.authorize('bob', request)).toMatchObject({ allowed: false, code: 'WORLD_PERMISSION_DENIED' });
    expect(authorization.authorize('missing', request)).toMatchObject({
      allowed: false,
      code: 'WORLD_PRINCIPAL_UNKNOWN',
    });
  });

  it('enforces self scope without leaking another entity', () => {
    const authorization = new WorldResourceAuthorizer(policy);
    expect(
      authorization.authorize('player', {
        resource: 'world.entity',
        operation: 'read',
        target: { kind: 'entity', entityId: 'player-1' },
      }),
    ).toMatchObject({ allowed: true });
    expect(
      authorization.authorize('player', {
        resource: 'world.entity',
        operation: 'read',
        target: { kind: 'entity', entityId: 'player-2' },
      }),
    ).toMatchObject({ allowed: false });
  });

  it('keeps developer observation, POI and path queries behind world scope', () => {
    const authorization = new WorldResourceAuthorizer(policy);
    const source = {
      actorId: 'player-1',
      entityId: 'player-1',
      sourceType: 'restricted',
      capabilities: ['query'],
    } as const;
    for (const command of [
      { type: 'query-observation', entityId: 'player-1' },
      { type: 'query-pois', entityId: 'player-1', radius: 10 },
      { type: 'query-path', entityId: 'player-1', position: [1, 2, 3] },
    ] as const) {
      const request = commandAuthorizationRequests(source, command)[0];
      expect(request.target).toEqual({ kind: 'world' });
      expect(authorization.authorize('player', request)).toMatchObject({
        allowed: false,
        code: 'WORLD_PERMISSION_DENIED',
      });
    }
  });

  it('keeps the command resource directory exhaustive', () => {
    const commandTypes: ServerCommand['type'][] = [
      'set-block',
      'fill',
      'teleport',
      'time-get',
      'time-set',
      'seed',
      'save',
      'inspect-voxel',
      'inspect-chunk',
      'query-player-state',
      'query-inventory',
      'query-entity',
      'query-nearby',
      'query-item-definitions',
      'query-voxel-definitions',
      'query-recipes',
      'query-observation',
      'query-pois',
      'query-action',
      'query-path',
      'select-slot',
      'break-voxel',
      'cancel-break',
      'place-voxel',
      'pickup-item',
      'drop-item',
      'use-item',
      'craft-recipe',
      'attack-entity',
      'start-action',
      'interrupt-action',
      'respawn',
      'give-item',
      'remove-item',
      'spawn-world-item',
      'spawn-creature',
      'spawn-actor',
      'register-poi',
      'remove-poi',
      'despawn-entity',
      'apply-damage',
      'heal',
      'advance-gameplay',
    ];
    expect(Object.keys(COMMAND_RESOURCE_DIRECTORY).sort()).toEqual([...commandTypes].sort());
  });

  it('requires both the actor action grant and the derived interaction target grant', () => {
    const source = {
      actorId: 'player-1',
      entityId: 'player-1',
      sourceType: 'player',
      capabilities: ['mutation'],
    } as const;
    expect(commandAuthorizationRequests(source, { type: 'attack-entity', entityId: 'hostile' })).toEqual([
      { resource: 'world.action', operation: 'execute', target: { kind: 'entity', entityId: 'player-1' } },
      { resource: 'world.interaction', operation: 'execute', target: { kind: 'entity', entityId: 'hostile' } },
    ]);
    expect(
      commandAuthorizationRequests(
        source,
        { type: 'query-action', entityId: 'player-1', actionId: 'foreign-action' },
        () => 'hostile',
      ),
    ).toEqual([{ resource: 'world.action', operation: 'read', target: { kind: 'entity', entityId: 'hostile' } }]);
  });
});
