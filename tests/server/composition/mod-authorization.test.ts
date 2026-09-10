import { describe, expect, it, vi } from 'vitest';

import {
  definePack,
  type ModModule,
  type ModuleInvocationValue,
  type PackDefinition,
} from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createAuthorizedModuleExecution,
  type VerifiedPackArtifact,
} from '@seedlands/game-core/server/composition/host-api';
import {
  WorldResourceAuthorizer,
  type WorldAuthorizationPolicy,
} from '../../../packages/game-core/src/server/harness/world-authorization';

const protectedModule: ModModule = {
  descriptor: {
    id: 'example:inventory-module',
    version: '1.0.0',
    resources: [{ id: 'example.inventory', operations: ['read', 'execute'] }],
    permissions: [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
  },
  register: () => undefined,
};

const verified = (definition: PackDefinition): VerifiedPackArtifact => ({
  ...definition,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

const policy: WorldAuthorizationPolicy = {
  principals: [
    { id: 'player-principal', labels: ['player'], boundEntityId: 'player-1' },
    { id: 'other-principal', labels: ['player'], boundEntityId: 'player-2' },
  ],
  rules: [
    {
      effect: 'allow',
      principal: { ids: ['player-principal'] },
      resources: ['example.inventory'],
      operations: ['read', 'execute'],
      scope: 'self',
    },
  ],
};

describe('module execution authorization', () => {
  it('rejects an unapproved Pack permission while assembling', () => {
    expect(() =>
      assembleWorldPacks(
        [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
        { approvedPermissions: {} },
      ),
    ).toThrow(/permission/i);
  });

  it('checks registered resource, host-bound principal and original actor before invoking an executor', () => {
    const composition = assembleWorldPacks(
      [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
      {
        approvedPermissions: {
          'example:root': [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
        },
      },
    );
    const authorizer = new WorldResourceAuthorizer(policy, composition.resources);
    const read = vi.fn((_context: unknown, input: unknown) => ({ secret: input }));
    const execute = vi.fn((context: unknown) => context);
    const facade = createAuthorizedModuleExecution({
      composition,
      moduleId: 'example:inventory-module',
      principalId: 'player-principal',
      originalActorId: 'player-1',
      authorizer,
      clone: structuredClone,
      executors: {
        'example.inventory': { read, execute },
      },
    });

    expect(
      facade.invoke({
        resource: 'example.inventory',
        operation: 'read',
        target: { kind: 'entity', entityId: 'player-2' },
        input: 'other-inventory',
      }),
    ).toMatchObject({ ok: false, code: 'WORLD_PERMISSION_DENIED' });
    expect(read).not.toHaveBeenCalled();

    expect(
      facade.invoke({
        resource: 'example.unknown',
        operation: 'read',
        target: { kind: 'entity', entityId: 'player-1' },
      }),
    ).toMatchObject({ ok: false, code: 'WORLD_RESOURCE_UNKNOWN' });
    expect(read).not.toHaveBeenCalled();

    expect(
      facade.invoke({
        resource: 'example.inventory',
        operation: 'execute',
        target: { kind: 'entity', entityId: 'player-1' },
        input: { actorId: 'player-2', labels: ['admin'] },
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'actor',
        principal: expect.objectContaining({ id: 'player-principal', boundEntityId: 'player-1' }),
        originalActorId: 'player-1',
        provenance: { packId: 'example:root', moduleId: 'example:inventory-module' },
        target: { kind: 'entity', entityId: 'player-1' },
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown principal and missing executor without side effects', () => {
    const composition = assembleWorldPacks(
      [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
      {
        approvedPermissions: {
          'example:root': [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
        },
      },
    );
    const authorizer = new WorldResourceAuthorizer(policy, composition.resources);
    const facade = createAuthorizedModuleExecution({
      composition,
      moduleId: 'example:inventory-module',
      principalId: 'forged-principal',
      originalActorId: 'player-1',
      authorizer,
      clone: structuredClone,
      executors: {},
    });
    expect(
      facade.invoke({
        resource: 'example.inventory',
        operation: 'read',
        target: { kind: 'entity', entityId: 'player-1' },
      }),
    ).toMatchObject({ ok: false, code: 'WORLD_PRINCIPAL_UNKNOWN' });
  });

  it('captures host bindings and executors when the facade is created', () => {
    const composition = assembleWorldPacks(
      [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
      {
        approvedPermissions: {
          'example:root': [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
        },
      },
    );
    const authorizer = new WorldResourceAuthorizer(policy, composition.resources);
    const original = vi.fn(() => 'original');
    const mutableExecutors = { 'example.inventory': { read: original } };
    const mutableInput = {
      composition,
      moduleId: 'example:inventory-module',
      principalId: 'player-principal',
      originalActorId: 'player-1',
      authorizer,
      clone: structuredClone,
      executors: mutableExecutors,
    };
    const facade = createAuthorizedModuleExecution(mutableInput);
    mutableInput.principalId = 'other-principal';
    mutableInput.originalActorId = 'player-2';
    mutableExecutors['example.inventory'].read = vi.fn(() => 'mutated');
    expect(
      facade.invoke({
        resource: 'example.inventory',
        operation: 'read',
        target: { kind: 'entity', entityId: 'player-1' },
      }),
    ).toEqual({ ok: true, value: 'original' });
    expect(original).toHaveBeenCalledOnce();
  });

  it('rejects an original actor that conflicts with the host-bound principal', () => {
    const composition = assembleWorldPacks(
      [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
      {
        approvedPermissions: {
          'example:root': [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
        },
      },
    );
    const authorizer = new WorldResourceAuthorizer(policy, composition.resources);
    expect(() =>
      createAuthorizedModuleExecution({
        composition,
        moduleId: 'example:inventory-module',
        principalId: 'player-principal',
        originalActorId: 'player-2',
        authorizer,
        clone: structuredClone,
        executors: {},
      }),
    ).toThrow(/original actor/i);
  });

  it('snapshots and freezes pure-data input before an async executor can observe caller mutation', async () => {
    const composition = assembleWorldPacks(
      [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
      {
        approvedPermissions: {
          'example:root': [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
        },
      },
    );
    const authorizer = new WorldResourceAuthorizer(policy, composition.resources);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async (context: unknown, input: unknown) => {
      await gate;
      return { context, input, frozen: Object.isFrozen(input) };
    });
    const facade = createAuthorizedModuleExecution({
      composition,
      moduleId: 'example:inventory-module',
      principalId: 'player-principal',
      originalActorId: 'player-1',
      authorizer,
      clone: structuredClone,
      executors: { 'example.inventory': { execute } },
    });
    const mutable = {
      actorId: 'player-2',
      target: { kind: 'entity', entityId: 'player-2' },
      payload: { count: 1 },
    };
    const result = facade.invoke({
      resource: 'example.inventory',
      operation: 'execute',
      target: { kind: 'entity', entityId: 'player-1' },
      input: mutable,
    });
    expect(result.ok).toBe(true);
    mutable.actorId = 'forged';
    mutable.target.entityId = 'forged';
    mutable.payload.count = 99;
    release?.();
    if (!result.ok) throw new Error('Expected authorized invocation.');
    await expect(result.value).resolves.toEqual({
      context: {
        kind: 'actor',
        principal: expect.objectContaining({ id: 'player-principal', boundEntityId: 'player-1' }),
        originalActorId: 'player-1',
        provenance: { packId: 'example:root', moduleId: 'example:inventory-module' },
        target: { kind: 'entity', entityId: 'player-1' },
      },
      input: {
        actorId: 'player-2',
        target: { kind: 'entity', entityId: 'player-2' },
        payload: { count: 1 },
      },
      frozen: true,
    });
  });

  it('rejects non-data invocation input before running the host executor', () => {
    const composition = assembleWorldPacks(
      [verified(definePack({ id: 'example:root', version: '1.0.0', kind: 'playbook', modules: [protectedModule] }))],
      {
        approvedPermissions: {
          'example:root': [{ resource: 'example.inventory', operations: ['read', 'execute'] }],
        },
      },
    );
    const authorizer = new WorldResourceAuthorizer(policy, composition.resources);
    const execute = vi.fn();
    const facade = createAuthorizedModuleExecution({
      composition,
      moduleId: 'example:inventory-module',
      principalId: 'player-principal',
      originalActorId: 'player-1',
      authorizer,
      clone: structuredClone,
      executors: { 'example.inventory': { execute } },
    });
    expect(() =>
      facade.invoke({
        resource: 'example.inventory',
        operation: 'execute',
        target: { kind: 'entity', entityId: 'player-1' },
        input: new Date() as unknown as ModuleInvocationValue,
      }),
    ).toThrow(/plain data|JSON-compatible/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
