import { describe, expect, it } from 'vitest';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session-types';
import type { ReferenceBootstrapContext } from '../../src/server/protocol/network-reference-bootstrap-types';
import { projectWelcomePresentationReference } from '../../src/server/protocol/network-reference-bootstrap-presentation';
import type { AuthorityReady } from '../../src/worker/authority-worker-protocol';

const body = (position = { x: 1, y: 2, z: 3 }) => ({
  id: 'player:bootstrap',
  type: 'player' as const,
  body: { position, velocity: { x: 4, y: 5, z: 6 } },
  grounded: true,
  contacts: [],
});

const snapshot = (overrides: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: 'epoch:bootstrap',
  physicsTick: 2,
  commitSequence: 3,
  worldMutationCount: 1,
  acknowledgedInputSequence: -1,
  inputResyncRequired: false,
  activeTimeMs: 20,
  integratedPhysicsTimeMs: 20,
  physicsDebtMs: 0,
  player: body(),
  entities: [body()],
  chunkRevisions: {},
  worldRevision: 1,
  worldTime: 21,
  paused: false,
  ...overrides,
});

const ready = (overrides: Partial<AuthorityReady> = {}): AuthorityReady => ({
  playerId: 'player:bootstrap',
  playerBodyPosition: [40, 50, 60],
  isNew: true,
  seed: 42,
  seedText: 'bootstrap-presentation-synthetic',
  generatorVersion: 1,
  worldTime: 21,
  frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
  snapshot: snapshot(),
  gameplay: {} as AuthorityReady['gameplay'],
  campPosition: [7, 8, 9],
  ...overrides,
});

const context = (overrides: Partial<ReferenceBootstrapContext> = {}): ReferenceBootstrapContext => ({
  worldId: 'world:bootstrap',
  serverEpoch: 'server:bootstrap',
  sessionId: 'session:bootstrap',
  contentVersion: 'content:v1',
  physicsSchema: { version: 1, bodyRegistryVersion: 1 },
  fluidSchema: { version: 1, encoding: 'fluid-v2' },
  publicCapabilities: [],
  limits: {
    metadataBytesMax: 64 * 1024,
    reliableMessageBytesMax: 1024 * 1024,
    baselineTransferBytesMax: 1024 * 1024,
    baselineInFlightBytesMax: 16 * 1024 * 1024,
    inboundMessagesPerSecond: 120,
    inboundBurst: 240,
    actionMessagesPerSecond: 20,
    interestKeysMax: 256,
    canonicalResidencyMax: 2048,
    sendQueueBytesMax: 4 * 1024 * 1024,
  },
  durableCommitSequence: -1,
  ...overrides,
});

describe('projectWelcomePresentationReference', () => {
  it('把 body、worldTime 与连接初始 checkpoint 绑定到同一当前 snapshot', () => {
    const initial = ready();
    const current = snapshot({
      physicsTick: 7,
      commitSequence: 9,
      activeTimeMs: 80,
      worldRevision: 5,
      worldTime: 4,
      player: body({ x: -4, y: 12, z: 13 }),
    });
    const projected = projectWelcomePresentationReference(initial, current, context({ durableCommitSequence: 8 }));

    expect(projected).toMatchObject({
      kind: 'welcome-presentation-reference',
      projectionVersion: 2,
      wireStatus: 'not-adopted',
      epoch: 'epoch:bootstrap',
      playerId: 'player:bootstrap',
      worldTime: 4,
      initialCheckpoint: {
        physicsTick: 7,
        commitSequence: 9,
        worldRevision: 5,
        durableCommitSequence: 8,
      },
      playerBody: {
        position: { x: -4, y: 12, z: 13 },
        velocity: { x: 4, y: 5, z: 6 },
        grounded: true,
      },
    });
    expect(projected.playerBody.position).not.toEqual({ x: 40, y: 50, z: 60 });
    expect(projected).not.toHaveProperty('firstAttach');
    expect(projected).not.toHaveProperty('reconnect');
    expect(projected.authorityStartPresentation).not.toHaveProperty('initialPresentationHandled');
  });

  it('只把 isNew 投影为 Authority 启动事实，并深复制 camp 与 body', () => {
    const sourceReady = ready();
    const sourcePosition = { x: 1, y: 2, z: 3 };
    const current = snapshot({ player: body(sourcePosition) });
    const projected = projectWelcomePresentationReference(sourceReady, current, context());

    expect(projected.authorityStartPresentation).toEqual({
      authorityStartPlayerWasCreated: true,
      campPosition: [7, 8, 9],
    });
    sourceReady.campPosition![0] = 999;
    sourcePosition.x = 998;
    expect(projected.authorityStartPresentation.campPosition).toEqual([7, 8, 9]);
    expect(projected.playerBody.position.x).toBe(1);

    expect(
      projectWelcomePresentationReference(ready({ isNew: false, campPosition: undefined }), current, context())
        .authorityStartPresentation,
    ).toEqual({ authorityStartPlayerWasCreated: false, campPosition: null });
  });

  it.each([
    ['ready player', ready({ playerId: 'player:other' }), snapshot()],
    ['current player', ready(), snapshot({ player: body(), entities: [body()], epoch: 'epoch:other' })],
    ['snapshot player', ready(), snapshot({ player: { ...body(), id: 'player:other' } })],
  ])('拒绝不一致的 %s 身份', (_label, sourceReady, current) => {
    expect(() => projectWelcomePresentationReference(sourceReady, current, context())).toThrow(/epoch|playerId/i);
  });

  it.each([
    ['physicsTick', { physicsTick: 1 }],
    ['activeTimeMs', { activeTimeMs: 19 }],
    ['commitSequence', { commitSequence: 2 }],
    ['worldRevision', { worldRevision: 0 }],
  ])('拒绝当前 snapshot 的 %s 倒退到启动锚点之前', (_field, overrides) => {
    expect(() => projectWelcomePresentationReference(ready(), snapshot(overrides), context())).toThrow(/older/i);
  });

  it('允许循环 worldTime 小于 ready 值，但拒绝实际生产域之外的值', () => {
    expect(projectWelcomePresentationReference(ready(), snapshot({ worldTime: 0.5 }), context()).worldTime).toBe(0.5);
    for (const worldTime of [-0.01, 24, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => projectWelcomePresentationReference(ready(), snapshot({ worldTime }), context())).toThrow(
        /worldTime/,
      );
  });

  it('接受 durable -1 与当前 C，并拒绝超过当前 C', () => {
    expect(projectWelcomePresentationReference(ready(), snapshot(), context()).initialCheckpoint).toHaveProperty(
      'durableCommitSequence',
      -1,
    );
    expect(
      projectWelcomePresentationReference(ready(), snapshot(), context({ durableCommitSequence: 3 })).initialCheckpoint
        .durableCommitSequence,
    ).toBe(3);
    expect(() =>
      projectWelcomePresentationReference(ready(), snapshot(), context({ durableCommitSequence: 4 })),
    ).toThrow(/durableCommitSequence/);
  });

  it.each([
    ['position', { position: { x: Number.NaN, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 } }],
    ['velocity', { position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: Infinity, z: 6 } }],
  ])('拒绝非 finite 的 player body %s', (_field, currentBody) => {
    expect(() =>
      projectWelcomePresentationReference(ready(), snapshot({ player: { ...body(), body: currentBody } }), context()),
    ).toThrow(/finite/i);
  });

  it('拒绝非法启动事实、camp 与继承的配置边界', () => {
    expect(() => projectWelcomePresentationReference(ready({ isNew: 'yes' as never }), snapshot(), context())).toThrow(
      /isNew/,
    );
    expect(() =>
      projectWelcomePresentationReference(ready({ campPosition: [1, Number.NaN, 3] }), snapshot(), context()),
    ).toThrow(/campPosition/);
    expect(() =>
      projectWelcomePresentationReference(
        ready({ frequencies: { physicsHz: 61 as never, gameplayHz: 20, fluidHz: 30 } }),
        snapshot(),
        context(),
      ),
    ).toThrow(/physicsHz/);
    expect(() =>
      projectWelcomePresentationReference(ready(), snapshot(), {
        ...context(),
        publicCapabilities: ['claimed'] as unknown as readonly [],
      }),
    ).toThrow(/capabilities/);
  });
});
