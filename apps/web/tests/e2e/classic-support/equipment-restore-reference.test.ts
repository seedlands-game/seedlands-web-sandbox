import { describe, expect, it, vi } from 'vitest';
import { verifyRestoredActorReferences } from './equipment-journey';
import type { HarnessEquipmentSnapshot } from '../../../src/app/app-contracts';
import type { WorldHarnessResult, WorldInspectResult } from '@seedlands/stdlib/server/harness/world-harness-contract';
import { assembleWorldPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { HeadlessSession } from '../../../../../packages/stdlib/src/server/headless/headless-session';
import { AuthorityWorldHarness } from '../../../../../packages/stdlib/src/server/harness/authority-world-harness';
import { WorldResourceAuthorizer } from '../../../../../packages/stdlib/src/server/harness/world-authorization';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import {
  BrowserAuthorityClient,
  type AuthorityWorkerPort,
} from '../../../src/client/authority/browser-authority-client';
import type { AuthorityResponse } from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { BrowserAuthorityResponse } from '../../../src/client/authority/pointer-attack-protocol';
import { pack as nonClassicPack } from '../../fixtures/packs/builder/builder';

type ActorReference = HarnessEquipmentSnapshot['actor'];
const oldReference: ActorReference = { entityId: 'player-1', epoch: 4, lifetime: 2 };
const currentReference: ActorReference = { entityId: 'player-1', epoch: 5, lifetime: 2 };
const frontier = {
  worldId: 'seedlands:restore-reference',
  epoch: 'runtime:2',
  worldRevision: 4,
  commitSequence: 6,
  physicsTick: 8,
  fluidWorkSequence: 0,
  logicObservationSequence: 0,
} as const;
const success = (reference: ActorReference, status: 'current' | 'stale') => ({
  ok: true as const,
  data: { kind: 'entity-reference' as const, reference, status },
  frontier,
});
type InspectionResult = WorldHarnessResult<WorldInspectResult>;
const createNonClassicComposition = () => {
  const artifact: VerifiedPackArtifact = {
    ...nonClassicPack,
    integrity: {
      algorithm: 'sha256',
      manifestDigest: 'a'.repeat(64),
      entryDigest: 'b'.repeat(64),
      resources: [],
    },
  };
  return assembleWorldPacks([artifact], {
    approvedPermissions: {
      [artifact.manifest.id]: artifact.modules.flatMap((module) => module.descriptor.permissions ?? []),
    },
  });
};
const stateOf = (session: HeadlessSession) => ({
  worldRevision: session.runtime.server.worldRevision,
  gameplayRevision: session.runtime.server.gameplayRevision,
  actor: session.runtime.server.getActorState(session.runtime.playerId),
  inventory: session.runtime.server.getInventoryPointerView(session.runtime.playerId),
  entities: session.runtime.server.queryEntities(),
});

class FakeAuthorityWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<BrowserAuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {}
  emit(message: AuthorityResponse) {
    this.onmessage?.({ data: message } as MessageEvent<BrowserAuthorityResponse>);
  }
}
const failures: readonly (readonly [string, InspectionResult])[] = [
  ['old-current', success(oldReference, 'current')],
  ['new-stale', success(currentReference, 'stale')],
  ['reference-mismatch', success({ ...oldReference, lifetime: oldReference.lifetime + 1 }, 'stale')],
  [
    'permission',
    {
      ok: false,
      error: { code: 'WORLD_PERMISSION_DENIED', message: 'denied', kind: 'permission' },
    },
  ],
  [
    'validation',
    {
      ok: false,
      error: { code: 'WORLD_REQUEST_INVALID', message: 'invalid', kind: 'validation' },
    },
  ],
];

const createNonClassicSession = (seedText: string) =>
  HeadlessSession.create({ createComposition: createNonClassicComposition, platform: testCorePlatform, seedText });

describe('entity-reference World Harness inspection', () => {
  it('resolves detached references across a non-Classic restore without mutating state', async () => {
    const session = await createNonClassicSession('reference-observability');
    try {
      const playerId = session.runtime.playerId;
      const oldReference = session.runtime.server.createEntityReference(playerId)!;
      const before = stateOf(session);
      const current = await session.world.inspect({ kind: 'entity-reference', reference: oldReference });
      expect(current).toMatchObject({
        ok: true,
        data: { kind: 'entity-reference', reference: oldReference, status: 'current' },
      });
      if (!current.ok) throw new Error(current.error.message);
      expect(current.data).not.toBe(oldReference);
      expect((current.data as { reference: unknown }).reference).not.toBe(oldReference);
      (current.data as { reference: { entityId: string } }).reference.entityId = 'mutated-response';
      expect(await session.world.inspect({ kind: 'entity-reference', reference: oldReference })).toMatchObject({
        ok: true,
        data: { reference: oldReference, status: 'current' },
      });
      expect(stateOf(session)).toEqual(before);

      const exported = await session.world.checkpoint({ kind: 'export' });
      if (!exported.ok || !exported.data.snapshot) throw new Error('checkpoint unavailable');
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot })).toMatchObject({
        ok: true,
      });
      const newReference = session.runtime.server.createEntityReference(playerId)!;
      const restored = stateOf(session);
      expect(await session.world.inspect({ kind: 'entity-reference', reference: oldReference })).toMatchObject({
        ok: true,
        data: { reference: oldReference, status: 'stale' },
      });
      expect(await session.world.inspect({ kind: 'entity-reference', reference: newReference })).toMatchObject({
        ok: true,
        data: { reference: newReference, status: 'current' },
      });
      for (const staleReference of [
        { ...newReference, epoch: newReference.epoch + 1 },
        { ...newReference, lifetime: newReference.lifetime + 1 },
        { ...newReference, entityId: 'missing-entity' },
      ])
        expect(await session.world.inspect({ kind: 'entity-reference', reference: staleReference })).toMatchObject({
          ok: true,
          data: { reference: staleReference, status: 'stale' },
        });
      expect(stateOf(session)).toEqual(restored);

      expect(await session.world.checkpoint({ kind: 'restore', snapshot: { version: 999 } as never })).toMatchObject({
        ok: false,
        error: { code: 'WORLD_CHECKPOINT_INVALID', kind: 'validation' },
      });
      expect(await session.world.inspect({ kind: 'entity-reference', reference: newReference })).toMatchObject({
        ok: true,
        data: { status: 'current' },
      });
      expect(stateOf(session)).toEqual(restored);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('validates and authorizes before resolving or observing existence', async () => {
    const session = await createNonClassicSession('reference-authorization');
    try {
      const playerId = session.runtime.playerId;
      const reference = session.runtime.server.createEntityReference(playerId)!;
      session.runtime.server.spawnEntity({
        id: 'foreign-existing',
        type: 'world-item',
        position: [1, 60, 1],
        stack: { itemId: 'sample:wood', count: 1 },
      });
      const foreignReference = session.runtime.server.createEntityReference('foreign-existing')!;
      const resolveReference = vi.spyOn(session.runtime.server, 'resolveEntityReference');
      const identity = await session.world.identity();
      if (!identity.ok) throw new Error(identity.error.message);
      const restricted = new AuthorityWorldHarness({
        platform: testCorePlatform,
        principalId: 'restricted-player',
        authorization: new WorldResourceAuthorizer({
          principals: [{ id: 'restricted-player', boundEntityId: playerId }],
          rules: [
            {
              effect: 'allow',
              principal: { ids: ['restricted-player'] },
              resources: ['world.entity'],
              operations: ['read'],
              scope: 'self',
            },
          ],
        }),
        owner: () => ({ runtime: session.runtime, epoch: identity.data.epoch, worldId: identity.data.worldId }),
        prepareChunk: async () => {},
        advance: async (elapsedMs) => session.runtime.advancePausedSession(elapsedMs),
        restore: async () => {
          throw new Error('unexpected restore');
        },
      });
      const before = stateOf(session);
      expect(await restricted.inspect({ kind: 'entity-reference', reference })).toMatchObject({
        ok: true,
        data: { reference, status: 'current' },
      });
      expect(resolveReference).toHaveBeenCalledOnce();
      resolveReference.mockClear();
      for (const candidate of [
        null,
        {},
        { kind: 'entity-reference' },
        { kind: 'entity-reference', reference, extra: true },
        { kind: 'entity-reference', reference: { ...reference, extra: true } },
        { kind: 'entity-reference', reference: { entityId: reference.entityId, epoch: reference.epoch } },
        Object.defineProperty({ kind: 'entity-reference' }, 'reference', { enumerable: true, get: () => reference }),
        { kind: 'entity-reference', reference: { ...reference, entityId: '' } },
        { kind: 'entity-reference', reference: { ...reference, entityId: ` ${playerId}` } },
        { kind: 'entity-reference', reference: { ...reference, entityId: 'x'.repeat(257) } },
        { kind: 'entity-reference', reference: { ...reference, epoch: 0 } },
        { kind: 'entity-reference', reference: { ...reference, epoch: 1.5 } },
        { kind: 'entity-reference', reference: { ...reference, lifetime: -1 } },
        { kind: 'entity-reference', reference: { ...reference, lifetime: Number.MAX_SAFE_INTEGER + 1 } },
      ])
        expect(await restricted.inspect(candidate as never)).toMatchObject({
          ok: false,
          error: { code: 'WORLD_REQUEST_INVALID', kind: 'validation' },
        });
      expect(resolveReference).not.toHaveBeenCalled();
      for (const foreign of [
        foreignReference,
        { ...reference, entityId: 'unknown', epoch: reference.epoch + 1, lifetime: reference.lifetime + 1 },
      ])
        expect(await restricted.inspect({ kind: 'entity-reference', reference: foreign })).toMatchObject({
          ok: false,
          error: { code: 'WORLD_PERMISSION_DENIED', kind: 'permission' },
        });
      expect(resolveReference).not.toHaveBeenCalled();
      expect(stateOf(session)).toEqual(before);
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('captures a request before queued execution', async () => {
    const session = await createNonClassicSession('reference-request-isolation');
    try {
      const reference = session.runtime.server.createEntityReference(session.runtime.playerId)!;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const blocked = session.world.hostOperation(() => gate);
      const request = { kind: 'entity-reference', reference: { ...reference } };
      const inspection = session.world.inspect(request as never);
      request.reference.entityId = 'mutated-after-submit';
      request.reference.epoch += 1;
      release();
      await blocked;
      expect(await inspection).toMatchObject({
        ok: true,
        data: { kind: 'entity-reference', reference, status: 'current' },
      });
    } finally {
      await session.dispose();
    }
  }, 30_000);

  it('round-trips current, stale, and failures over the Browser Worker adapter', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const reference = { entityId: 'player-1', epoch: 1, lifetime: 1 };
    const current = client.world.inspect({ kind: 'entity-reference', reference });
    const currentRequest = worker.posts.at(-1) as {
      kind: string;
      requestId: number;
      runtimeEpoch: string;
      method: string;
      args: unknown[];
    };
    expect(currentRequest).toMatchObject({
      kind: 'world-harness-rpc',
      protocolVersion: 1,
      epoch: 'world:1',
      method: 'inspect',
      runtimeEpoch: 'world:1',
      args: [{ kind: 'entity-reference', reference }],
    });
    expect(currentRequest.requestId).toBeGreaterThan(0);
    const returnedReference = { ...reference };
    worker.emit(
      structuredClone({
        kind: 'world-harness-response',
        protocolVersion: 1,
        epoch: 'world:1',
        requestId: currentRequest.requestId,
        result: {
          ok: true,
          data: { kind: 'entity-reference', reference: returnedReference, status: 'current' },
          frontier,
        },
      }) as AuthorityResponse,
    );
    const currentResult = await current;
    expect(currentResult).toMatchObject({
      ok: true,
      data: { kind: 'entity-reference', reference, status: 'current' },
    });
    expect((currentResult as { data: { reference: unknown } }).data.reference).not.toBe(returnedReference);
    (currentResult as { data: { reference: { entityId: string } } }).data.reference.entityId = 'mutated-response';
    expect(reference.entityId).toBe('player-1');

    const staleReference = { ...reference, epoch: 2 };
    const stale = client.world.inspect({ kind: 'entity-reference', reference: staleReference });
    const staleRequest = worker.posts.at(-1) as { requestId: number };
    expect(staleRequest.requestId).toBeGreaterThan(currentRequest.requestId);
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: staleRequest.requestId,
      result: {
        ok: true,
        data: { kind: 'entity-reference', reference: { ...staleReference }, status: 'stale' },
        frontier,
      },
    } as AuthorityResponse);
    await expect(stale).resolves.toMatchObject({ ok: true, data: { reference: staleReference, status: 'stale' } });

    for (const [code, kind] of [
      ['WORLD_PERMISSION_DENIED', 'permission'],
      ['WORLD_REQUEST_INVALID', 'validation'],
    ] as const) {
      const failed = client.world.inspect({ kind: 'entity-reference', reference: staleReference });
      const failedRequest = worker.posts.at(-1) as { requestId: number };
      worker.emit({
        kind: 'world-harness-response',
        protocolVersion: 1,
        epoch: 'world:1',
        requestId: failedRequest.requestId,
        result: { ok: false, error: { code, message: code, kind } },
      });
      await expect(failed).resolves.toMatchObject({ ok: false, error: { code, kind } });
    }
  });
});

describe('Classic equipment restore reference consumer', () => {
  it('passes the exact old and current values to inspection before continuing through the existing UI driver', async () => {
    const order: string[] = [];
    const inspect = vi.fn(async ({ reference }: { reference: ActorReference }) => {
      order.push(reference.epoch === oldReference.epoch ? 'inspect-old' : 'inspect-current');
      return success(reference, reference.epoch === oldReference.epoch ? 'stale' : 'current');
    });
    const continuation = vi.fn(async () => {
      order.push('ui');
      return 'ui-continued';
    });
    await expect(verifyRestoredActorReferences(inspect, oldReference, currentReference, continuation)).resolves.toEqual(
      {
        referenceStatus: {
          old: success(oldReference, 'stale').data,
          current: success(currentReference, 'current').data,
        },
        continuation: 'ui-continued',
      },
    );
    expect(inspect.mock.calls.map(([request]) => request)).toEqual([
      { kind: 'entity-reference', reference: oldReference },
      { kind: 'entity-reference', reference: currentReference },
    ]);
    expect(continuation).toHaveBeenCalledWith({
      old: success(oldReference, 'stale').data,
      current: success(currentReference, 'current').data,
    });
    expect(order).toEqual(['inspect-old', 'inspect-current', 'ui']);
  });

  it.each(failures)('rejects %s before continuing the UI journey', async (kind, failure) => {
    const inspect = vi.fn(async ({ reference }: { reference: ActorReference }) => {
      if (kind === 'new-stale' && reference.epoch === oldReference.epoch) return success(reference, 'stale');
      return failure;
    });
    const continuation = vi.fn(async () => 'must-not-run');
    await expect(
      verifyRestoredActorReferences(inspect, oldReference, currentReference, continuation),
    ).rejects.toThrow();
    expect(continuation).not.toHaveBeenCalled();
  });

  it('rejects transport failure before continuing the UI journey', async () => {
    const continuation = vi.fn(async () => 'must-not-run');
    await expect(
      verifyRestoredActorReferences(
        async () => {
          throw new Error('transport-failed');
        },
        oldReference,
        currentReference,
        continuation,
      ),
    ).rejects.toThrow('transport-failed');
    expect(continuation).not.toHaveBeenCalled();
  });
});
