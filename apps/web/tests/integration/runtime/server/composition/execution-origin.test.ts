import { describe, expect, it } from 'vitest';
import { definePack, type ModModule, type PackDefinition } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks } from '../../../../../../../packages/stdlib/src/server/composition/assembly';
import type {
  VerifiedPackArtifact,
  WorldComposition,
} from '../../../../../../../packages/stdlib/src/server/composition/contracts';
import {
  captureDurableExecutionOrigin,
  rebindDurableExecutionOrigin,
  validateDurableExecutionOrigin,
} from '../../../../../../../packages/stdlib/src/server/composition/execution-origin';
import {
  WorldResourceAuthorizer,
  type WorldAuthorizationPolicy,
} from '../../../../../../../packages/stdlib/src/server/harness/world-authorization';
import type { EntityIdentityPort } from '../../../../../../../packages/stdlib/src/server/simulation/action-identity';

const MODULE_ID = 'example:inventory-module';
const PACK_ID = 'example:root';
const RESOURCE = 'example.inventory';
const SUBJECT = 'account:stable-player';

const verified = (definition: PackDefinition): VerifiedPackArtifact => ({
  ...definition,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

const composition = (modulePermission = true): WorldComposition => {
  const module: ModModule = {
    descriptor: {
      id: MODULE_ID,
      version: '1.0.0',
      resources: [{ id: RESOURCE, operations: ['execute'] }],
      permissions: modulePermission ? [{ resource: RESOURCE, operations: ['execute'] }] : [],
    },
    register: () => undefined,
  };
  return assembleWorldPacks(
    [verified(definePack({ id: PACK_ID, version: '1.0.0', kind: 'playbook', modules: [module] }))],
    modulePermission ? { approvedPermissions: { [PACK_ID]: [{ resource: RESOURCE, operations: ['execute'] }] } } : {},
  );
};

const worldAuthorizer = (value: WorldAuthorizationPolicy, current = composition()) =>
  new WorldResourceAuthorizer(value, current.resources);

const policy = (
  id: string,
  options: Readonly<{
    subject?: string;
    boundEntityId?: string;
    allow?: boolean;
  }> = {},
): WorldAuthorizationPolicy => ({
  principals: [
    {
      id,
      labels: ['player'],
      ...(options.subject === undefined ? {} : { subject: options.subject }),
      boundEntityId: options.boundEntityId ?? 'actor-1',
    },
  ],
  rules:
    options.allow === false
      ? []
      : [
          {
            effect: 'allow',
            principal: { ids: [id] },
            resources: [RESOURCE],
            operations: ['execute'],
            scope: 'self',
          },
        ],
});

const identity = (epoch: number, lifetime: number, present = true): EntityIdentityPort => {
  const current = { entityId: 'actor-1', epoch, lifetime } as const;
  return Object.freeze({
    referenceFor: (entityId: string) => (present && entityId === current.entityId ? { ...current } : null),
    resolve: (reference) =>
      present &&
      reference.entityId === current.entityId &&
      reference.epoch === current.epoch &&
      reference.lifetime === current.lifetime
        ? current.entityId
        : null,
    rebind: (reference) =>
      present && reference.entityId === current.entityId && reference.lifetime === current.lifetime
        ? { ...current }
        : null,
  });
};

const request = (entityId = 'actor-1') =>
  ({ resource: RESOURCE, operation: 'execute', target: { kind: 'entity', entityId } }) as const;

const capture = () =>
  captureDurableExecutionOrigin({
    composition: composition(),
    authorizer: worldAuthorizer(policy('browser:player', { subject: SUBJECT })),
    identity: identity(4, 7),
    binding: { moduleId: MODULE_ID, principalId: 'browser:player', originalActorId: 'actor-1' },
    request: request(),
  });

describe('WorldResourceAuthorizer stable subjects', () => {
  it('maps only an explicitly configured exact subject', () => {
    const authorizer = worldAuthorizer(policy('browser:player', { subject: SUBJECT }));
    expect(authorizer.principalForSubject(SUBJECT)?.id).toBe('browser:player');
    expect(authorizer.principalForSubject('browser:player')).toBeNull();
    expect(authorizer.principalForSubject('player')).toBeNull();

    const legacy = worldAuthorizer(policy('legacy-alias'));
    expect(legacy.principal('legacy-alias')?.id).toBe('legacy-alias');
    expect(legacy.principalForSubject('legacy-alias')).toBeNull();
  });

  it('rejects empty, padded, overlong and duplicate configured subjects', () => {
    for (const subject of ['', '  ', ' padded', 'padded ', 'x'.repeat(257)])
      expect(() => worldAuthorizer(policy('alias', { subject }))).toThrow(/subject/i);

    expect(() =>
      worldAuthorizer({
        principals: [
          { id: 'browser:player', subject: SUBJECT },
          { id: 'headless:player', subject: SUBJECT },
        ],
        rules: [],
      }),
    ).toThrow(/duplicate.*subject/i);
  });
});

describe('durable execution origin capture and schema', () => {
  it('captures frozen host-neutral data without an alias or epoch and validates JSON roundtrip', () => {
    const origin = capture();
    expect(origin).toEqual({
      version: 1,
      principalSubject: SUBJECT,
      provenance: { packId: PACK_ID, moduleId: MODULE_ID },
      originalActor: { entityId: 'actor-1', lifetime: 7 },
    });
    expect('epoch' in origin.originalActor).toBe(false);
    expect(JSON.stringify(origin)).not.toContain('browser:player');
    expect(Object.isFrozen(origin)).toBe(true);
    expect(Object.isFrozen(origin.provenance)).toBe(true);
    expect(Object.isFrozen(origin.originalActor)).toBe(true);
    expect(validateDurableExecutionOrigin(JSON.parse(JSON.stringify(origin)))).toEqual(origin);
  });

  it('rejects malformed schemas including a saved runtime epoch', () => {
    const origin = capture();
    const invalid: unknown[] = [
      { ...origin, version: 2 },
      { ...origin, principalSubject: '' },
      { ...origin, principalSubject: 'x'.repeat(257) },
      { ...origin, alias: 'browser:player' },
      { ...origin, provenance: { ...origin.provenance, extra: true } },
      { ...origin, originalActor: { ...origin.originalActor, epoch: 4 } },
      { ...origin, originalActor: { ...origin.originalActor, lifetime: -1 } },
    ];
    for (const value of invalid) expect(() => validateDurableExecutionOrigin(value)).toThrow();
  });

  it('rejects accessors without invoking them while inspecting untrusted schema fields', () => {
    let reads = 0;
    const raw = {
      version: 1,
      provenance: { packId: PACK_ID, moduleId: MODULE_ID },
      originalActor: { entityId: 'actor-1', lifetime: 7 },
    } as Record<string, unknown>;
    Object.defineProperty(raw, 'principalSubject', {
      enumerable: true,
      get() {
        reads += 1;
        return SUBJECT;
      },
    });

    expect(() => validateDurableExecutionOrigin(raw)).toThrow(/shape|descriptor|data/i);
    expect(reads).toBe(0);
  });

  it('fails capture for missing subject, wrong host actor, missing actor or denied current request', () => {
    const base = {
      composition: composition(),
      identity: identity(1, 1),
      binding: { moduleId: MODULE_ID, principalId: 'alias', originalActorId: 'actor-1' },
      request: request(),
    } as const;
    expect(() =>
      captureDurableExecutionOrigin({
        ...base,
        authorizer: worldAuthorizer(policy('alias')),
      }),
    ).toThrow(/subject/i);
    expect(() =>
      captureDurableExecutionOrigin({
        ...base,
        authorizer: worldAuthorizer(policy('alias', { subject: SUBJECT, boundEntityId: 'actor-2' })),
      }),
    ).toThrow(/actor/i);
    expect(() =>
      captureDurableExecutionOrigin({
        ...base,
        identity: identity(1, 1, false),
        authorizer: worldAuthorizer(policy('alias', { subject: SUBJECT })),
      }),
    ).toThrow(/actor|binding/i);
    expect(() =>
      captureDurableExecutionOrigin({
        ...base,
        authorizer: worldAuthorizer(policy('alias', { subject: SUBJECT, allow: false })),
      }),
    ).toThrow(/permission|denied/i);
    expect(() =>
      captureDurableExecutionOrigin({
        ...base,
        composition: composition(false),
        authorizer: worldAuthorizer(policy('alias', { subject: SUBJECT })),
      }),
    ).toThrow(/module.*permission/i);
  });
});

describe('durable execution origin rebind', () => {
  it('rebinds Browser and Headless aliases by exact subject using a fresh epoch and same lifetime', () => {
    const saved = JSON.parse(JSON.stringify(capture()));
    const rebound = rebindDurableExecutionOrigin({
      origin: validateDurableExecutionOrigin(saved),
      composition: composition(),
      authorizer: worldAuthorizer(policy('headless:player', { subject: SUBJECT })),
      identity: identity(91, 7),
      request: request(),
    });

    expect(rebound.binding).toEqual({
      moduleId: MODULE_ID,
      principalId: 'headless:player',
      originalActorId: 'actor-1',
    });
    expect(rebound.actorReference).toEqual({ entityId: 'actor-1', epoch: 91, lifetime: 7 });
    expect(rebound.context).toEqual({
      kind: 'actor',
      principal: expect.objectContaining({ id: 'headless:player', subject: SUBJECT }),
      originalActorId: 'actor-1',
      provenance: { packId: PACK_ID, moduleId: MODULE_ID },
      target: { kind: 'entity', entityId: 'actor-1' },
    });
  });

  it('fails for a missing mapping, revoked grant or target no longer authorized', () => {
    const origin = capture();
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(),
        authorizer: worldAuthorizer(policy('headless:player')),
        identity: identity(9, 7),
        request: request(),
      }),
    ).toThrow(/subject|principal/i);
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(),
        authorizer: worldAuthorizer(policy('headless:player', { subject: SUBJECT, allow: false })),
        identity: identity(9, 7),
        request: request(),
      }),
    ).toThrow(/permission|denied/i);
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(),
        authorizer: worldAuthorizer(policy('headless:player', { subject: SUBJECT })),
        identity: identity(9, 7),
        request: request('actor-2'),
      }),
    ).toThrow(/permission|denied/i);
  });

  it('fails for revoked module permission or unknown provenance', () => {
    const origin = capture();
    const currentAuthorizer = () => worldAuthorizer(policy('headless:player', { subject: SUBJECT }));
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(false),
        authorizer: currentAuthorizer(),
        identity: identity(9, 7),
        request: request(),
      }),
    ).toThrow(/module.*permission/i);

    for (const provenance of [
      { packId: 'other:pack', moduleId: MODULE_ID },
      { packId: PACK_ID, moduleId: 'other:module' },
    ])
      expect(() =>
        rebindDurableExecutionOrigin({
          origin: validateDurableExecutionOrigin({ ...origin, provenance }),
          composition: composition(),
          authorizer: currentAuthorizer(),
          identity: identity(9, 7),
          request: request(),
        }),
      ).toThrow(/provenance|module|pack/i);
  });

  it('fails for actor lifetime replacement, missing actor or current principal actor mismatch', () => {
    const origin = capture();
    const current = (boundEntityId = 'actor-1') =>
      worldAuthorizer(policy('headless:player', { subject: SUBJECT, boundEntityId }));
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(),
        authorizer: current(),
        identity: identity(9, 8),
        request: request(),
      }),
    ).toThrow(/lifetime/i);
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(),
        authorizer: current(),
        identity: identity(9, 7, false),
        request: request(),
      }),
    ).toThrow(/missing|binding/i);
    expect(() =>
      rebindDurableExecutionOrigin({
        origin,
        composition: composition(),
        authorizer: current('actor-2'),
        identity: identity(9, 7),
        request: request(),
      }),
    ).toThrow(/actor/i);
  });
});
