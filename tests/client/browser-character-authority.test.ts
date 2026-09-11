import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { BrowserCharacterAuthority } from '../../apps/web/src/worker/authority-worker-character-control';
import { testCorePlatform } from '../support/core-platform';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';

const profile = { name: 'Lin', personality: 'Practical and kind.', riskTolerance: 0.25 } as const;
const createComposition = () =>
  assembleOverworldPacks([
    {
      ...overworld,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
const createSession = (seedText: string) =>
  HeadlessSession.create({ platform: testCorePlatform, seedText, createComposition });

describe('Browser character authority', () => {
  it('applies the shared resource policy to a bound visitor before execution', async () => {
    const session = await createSession('bound-resource-policy');
    try {
      const authority = new BrowserCharacterAuthority({
        runtime: () => session.runtime,
        worldId: () => 'world-id',
        worldEpoch: () => 'world:0',
        authorizationRules: [
          { effect: 'deny', resources: ['world.character'], operations: ['execute'], scope: 'self' },
        ],
      });
      const created = authority.trusted({ kind: 'create', profile });
      if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
      const character = created.data.character;
      const binding = authority.bind(character.entityId);
      expect(authority.trusted({ kind: 'capabilities', entityId: character.entityId })).toMatchObject({
        ok: false,
        error: { code: 'WORLD_PERMISSION_DENIED' },
      });
      expect(authority.control(binding, 1, { kind: 'capabilities', entityId: character.entityId })).toMatchObject({
        ok: true,
        data: { kind: 'capabilities', capabilities: expect.any(Array) },
      });
      expect(authority.control(binding, 2, { kind: 'observe', entityId: character.entityId })).toMatchObject({
        ok: true,
      });
      expect(
        authority.control(binding, 3, {
          kind: 'intent',
          entityId: character.entityId,
          requestId: 'policy-denied',
          expectedRevision: character.revision,
          expectedCursor: character.eventCursor,
          goal: { kind: 'idle' },
        }),
      ).toMatchObject({ ok: false, error: { code: 'WORLD_PERMISSION_DENIED' } });
      expect(authority.trusted({ kind: 'inspect', entityId: character.entityId })).toMatchObject({
        ok: true,
        data: { character: { revision: character.revision } },
      });
    } finally {
      await session.dispose();
    }
  }, 20000);
  it('enforces proximity for dialogue and requires an Authority binding for writes', async () => {
    const session = await createSession('browser-character');
    const worldEpoch = 'world:0';
    const authority = new BrowserCharacterAuthority({
      runtime: () => session.runtime,
      worldId: () => 'world-id',
      worldEpoch: () => worldEpoch,
    });
    const created = authority.trusted({ kind: 'create', profile });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    expect(
      authority.trusted({
        kind: 'intent',
        entityId,
        requestId: 'unbound',
        expectedRevision: 0,
        goal: { kind: 'idle' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'WORLD_PERMISSION_DENIED' } });

    expect(authority.trusted({ kind: 'dialogue', entityId, text: 'Hello.' })).toMatchObject({ ok: true });
    session.runtime.setPlayerPosition([100, 34, 100]);
    expect(authority.trusted({ kind: 'dialogue', entityId, text: 'Too far.' })).toMatchObject({
      ok: false,
      error: { code: 'CHARACTER_UNAVAILABLE' },
    });
    await session.dispose();
  });

  it('rejects forged, repeated and stale-generation bound requests before mutation', async () => {
    const session = await createSession('browser-binding');
    let worldEpoch = 'world:0';
    const authority = new BrowserCharacterAuthority({
      runtime: () => session.runtime,
      worldId: () => 'world-id',
      worldEpoch: () => worldEpoch,
    });
    const created = authority.trusted({ kind: 'create', profile });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const binding = authority.bind(entityId);
    expect(authority.control(binding, 1, { kind: 'observe', entityId })).toMatchObject({ ok: true });
    expect(
      authority.control(binding, 1, {
        kind: 'memory',
        entityId,
        expectedMemoryRevision: 0,
        throughCursor: 0,
        summary: 'must not apply',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CHARACTER_SEQUENCE_STALE' } });
    expect(authority.trusted({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { character: { memory: { revision: 0 } } },
    });
    expect(
      authority.control({ ...binding, entityId: 'forged' }, 2, { kind: 'observe', entityId: 'forged' }),
    ).toMatchObject({ ok: false, error: { code: 'CHARACTER_BINDING_INVALID' } });
    worldEpoch = 'world:1';
    expect(authority.control(binding, 2, { kind: 'observe', entityId })).toMatchObject({
      ok: false,
      error: { code: 'CHARACTER_BINDING_INVALID' },
    });
    expect(authority.unbind(binding)).toBe(true);
    expect(authority.unbind(binding)).toBe(false);
    await session.dispose();
  });

  it('rejects a bound intent when dialogue advanced its cursor and validates a required cursor before sequence', async () => {
    const session = await createSession('browser-stale-dialogue');
    const authority = new BrowserCharacterAuthority({
      runtime: () => session.runtime,
      worldId: () => 'world-id',
      worldEpoch: () => 'world:0',
    });
    const created = authority.trusted({ kind: 'create', profile });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const binding = authority.bind(entityId);
    const observed = authority.control(binding, 1, { kind: 'observe', entityId });
    if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(authority.trusted({ kind: 'dialogue', entityId, text: 'Please stop.' })).toMatchObject({ ok: true });
    expect(
      authority.control(binding, 2, {
        kind: 'intent',
        entityId,
        requestId: 'stale-dialogue',
        expectedRevision: 0,
        expectedCursor: observed.data.observation.cursor,
        goal: { kind: 'idle' },
        say: 'Continuing the old plan.',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CHARACTER_REVISION_CONFLICT' } });
    expect(authority.trusted({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { character: { revision: 0, currentGoal: { goal: { kind: 'forage' } } } },
    });
    for (const expectedCursor of [undefined, -1, Number.MAX_SAFE_INTEGER + 1, '0'])
      expect(
        authority.control(binding, 3, {
          kind: 'intent',
          entityId,
          requestId: 'missing-cursor',
          expectedRevision: 0,
          expectedCursor,
          goal: { kind: 'idle' },
        } as never),
      ).toMatchObject({ ok: false, error: { code: 'WORLD_REQUEST_INVALID' } });
    expect(
      authority.control(binding, 3, {
        kind: 'intent',
        entityId,
        requestId: 'fresh-dialogue',
        expectedRevision: 0,
        expectedCursor: 1,
        goal: { kind: 'idle' },
      }),
    ).toMatchObject({ ok: true, data: { kind: 'intent' } });
    await session.dispose();
  });

  it('invalidates an existing binding when its character dies and retains terminal identity', async () => {
    const session = await createSession('browser-character-death');
    const authority = new BrowserCharacterAuthority({
      runtime: () => session.runtime,
      worldId: () => 'world-id',
      worldEpoch: () => 'world:0',
    });
    const created = authority.trusted({ kind: 'create', profile });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const binding = authority.bind(entityId);
    session.runtime.server.despawnEntity(entityId);

    expect(authority.control(binding, 1, { kind: 'observe', entityId })).toMatchObject({
      ok: false,
      error: { code: 'CHARACTER_BINDING_INVALID' },
    });
    expect(authority.trusted({ kind: 'list' })).toMatchObject({
      ok: true,
      data: { kind: 'list', characters: [{ entityId, lifecycle: 'deceased' }] },
    });
    expect(() => authority.bind(entityId)).toThrow(/CHARACTER_UNAVAILABLE/);
    await session.dispose();
  });
});
