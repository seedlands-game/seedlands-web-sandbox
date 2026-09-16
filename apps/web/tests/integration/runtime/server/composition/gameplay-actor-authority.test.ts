import { describe, expect, it } from 'vitest';
import { createGameplayActorAuthority } from '../../../../../../../packages/stdlib/src/server/composition/gameplay-actor-authority';
import { WorldResourceAuthorizer } from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';

const resources = [
  { id: 'seedlands.combat', operations: ['read', 'write', 'execute'] as const },
  { id: 'seedlands.combat-clock', operations: ['read', 'write', 'execute'] as const },
  { id: 'seedlands.inventory', operations: ['read', 'write', 'execute'] as const },
  { id: 'seedlands.inventory-item', operations: ['read', 'execute'] as const },
  { id: 'seedlands.mode', operations: ['read', 'write', 'execute'] as const },
  { id: 'seedlands.ruleset', operations: ['read'] as const },
];
const request = {
  resource: 'seedlands.combat',
  operation: 'execute' as const,
  target: { kind: 'entity' as const, entityId: 'target' },
};
const origin = (subject: string, actorId = 'alice') => ({
  version: 1 as const,
  principalSubject: subject,
  provenance: { packId: 'seedlands:overworld', moduleId: 'seedlands:combat-module' },
  originalActor: { entityId: actorId, lifetime: 1 },
});

describe('explicit product actor authority', () => {
  it('maps the same player subject to current host aliases with no clock or developer privileges', () => {
    const browser = createGameplayActorAuthority(resources, { playerAlias: 'browser-player' });
    const headless = createGameplayActorAuthority(resources, { playerAlias: 'headless-player' });
    const initial = browser.forActor('alice', 'player')!;
    const subject = initial.authorizer.principal(initial.principalId)!.subject!;
    const restored = headless.resolveOrigin(origin(subject), 'player')!;
    expect(initial.principalId).toBe('browser-player');
    expect(restored.principalId).toBe('headless-player');
    expect(restored.authorizer.principal(restored.principalId)).toMatchObject({
      subject,
      boundEntityId: 'alice',
      kind: 'actor',
    });
    expect(restored.authorizer.authorize(restored.principalId, request).allowed).toBe(true);
    for (const resource of ['seedlands.combat-clock', 'world.voxel', 'world.checkpoint'])
      expect(
        restored.authorizer.authorize(restored.principalId, { ...request, resource, target: { kind: 'world' } })
          .allowed,
      ).toBe(false);
    expect(headless.resolveOrigin(origin('unknown'), 'player')).toBeUndefined();
    expect(headless.resolveOrigin(origin(subject), 'creature')).toBeUndefined();
  });
  it('grants ordinary players only their own inventory and mode while allowing item pickup', () => {
    const binding = createGameplayActorAuthority(resources, { playerAlias: 'human' }).forActor('alice', 'player')!;
    for (const resource of ['seedlands.inventory', 'seedlands.mode']) {
      expect(
        binding.authorizer.authorize(binding.principalId, {
          resource,
          operation: 'read',
          target: { kind: 'entity', entityId: 'alice' },
        }).allowed,
      ).toBe(true);
      expect(
        binding.authorizer.authorize(binding.principalId, {
          resource,
          operation: 'read',
          target: { kind: 'entity', entityId: 'bob' },
        }).allowed,
      ).toBe(false);
    }
    expect(
      binding.authorizer.authorize(binding.principalId, {
        resource: 'seedlands.inventory-item',
        operation: 'execute',
        target: { kind: 'entity', entityId: 'drop' },
      }).allowed,
    ).toBe(true);
  });
  it('uses an ordinary autonomy principal and retains the real actor separately', () => {
    const authority = createGameplayActorAuthority(resources, { playerAlias: 'headless-player' });
    const npc = authority.forActor('wolf', 'creature')!;
    expect(npc.authorizer.principal(npc.principalId)).toEqual({
      id: 'gameplay-autonomy',
      kind: 'actor',
      subject: 'seedlands:autonomy',
      labels: [],
    });
    expect(authority.resolveOrigin(origin('seedlands:autonomy', 'wolf'), 'creature')!.principalId).toBe(
      'gameplay-autonomy',
    );
    expect(authority.resolveOrigin(origin('seedlands:autonomy'), 'player')).toBeUndefined();
    expect(authority.forActor('drop', 'world-item')).toBeUndefined();
  });
  it('reuses current script policy including revocation without substituting product or admin grants', () => {
    const scriptAuthorization = new WorldResourceAuthorizer(
      {
        principals: [{ id: 'script-now', subject: 'test:script', boundEntityId: 'alice' }, { id: 'admin' }],
        rules: [{ effect: 'deny', resources: ['seedlands.combat'], operations: ['execute'], scope: 'any' }],
      },
      resources,
    );
    const authority = createGameplayActorAuthority(resources, { playerAlias: 'headless-player', scriptAuthorization });
    const current = authority.resolveOrigin(origin('test:script'), 'player')!;
    expect(current.authorizer).toBe(scriptAuthorization);
    expect(current.principalId).toBe('script-now');
    expect(current.authorizer.authorize(current.principalId, request).allowed).toBe(false);
    expect(authority.resolveOrigin(origin('test:script', 'other'), 'player')).toBeUndefined();
    expect(authority.resolveOrigin(origin('admin'), 'player')).toBeUndefined();
  });
});
