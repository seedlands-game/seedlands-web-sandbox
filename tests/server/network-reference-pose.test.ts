import { describe, expect, it } from 'vitest';
import type { AuthoritySnapshot } from '../../packages/game-core/src/server/authority/authority-session-types';
import { projectEntityPoseReference } from '../../packages/game-core/src/server/protocol/network-reference-pose';

const entity = (
  id: string,
  overrides: Partial<AuthoritySnapshot['entities'][number]> = {},
): AuthoritySnapshot['entities'][number] => ({
  id,
  type: 'creature',
  archetype: 'grazer',
  body: {
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 4, y: 5, z: 6 },
  },
  grounded: true,
  contacts: [],
  ...overrides,
});

const snapshot = (
  entities: AuthoritySnapshot['entities'] = [entity('entity-b'), entity('entity-a')],
): AuthoritySnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: 'epoch:pose-synthetic',
  physicsTick: 12,
  commitSequence: 9,
  worldMutationCount: 4,
  acknowledgedInputSequence: 3,
  inputResyncRequired: false,
  activeTimeMs: 100,
  integratedPhysicsTimeMs: 100,
  physicsDebtMs: 0,
  player: entity('player', { type: 'player', archetype: undefined }),
  entities,
  chunkRevisions: { '0,0,0': 7 },
  worldRevision: 7,
  worldTime: 8,
  paused: false,
  diagnostics: { recoveryResults: [] },
});

describe('projectEntityPoseReference', () => {
  it('从 synthetic AuthoritySnapshot 投影确定顺序和独立 pose 副本', () => {
    const source = snapshot([
      entity('settler-b', { type: 'npc', archetype: 'settler' }),
      entity('item-a', { type: 'world-item', archetype: undefined, grounded: false }),
    ]);
    const projected = projectEntityPoseReference(source, { publicationSequence: 14 });

    expect(projected).toEqual({
      kind: 'entity-pose-reference',
      projectionVersion: 1,
      epoch: 'epoch:pose-synthetic',
      publicationSequence: 14,
      physicsTick: 12,
      commitSequence: 9,
      worldRevision: 7,
      entities: [
        {
          id: 'item-a',
          type: 'world-item',
          position: { x: 1, y: 2, z: 3 },
          velocity: { x: 4, y: 5, z: 6 },
          grounded: false,
        },
        {
          id: 'settler-b',
          type: 'npc',
          archetype: 'settler',
          position: { x: 1, y: 2, z: 3 },
          velocity: { x: 4, y: 5, z: 6 },
          grounded: true,
        },
      ],
    });
    expect(projected).not.toHaveProperty('diagnostics');
    expect(projected.entities[0]).not.toHaveProperty('contacts');

    projected.entities[0]!.position.x = 99;
    projected.entities[0]!.velocity.z = 88;
    expect(source.entities[1]!.body.position.x).toBe(1);
    expect(source.entities[1]!.body.velocity.z).toBe(6);
  });

  it('接受 synthetic 256 实体边界并拒绝 257，不静默裁剪', () => {
    const atLimit = Array.from({ length: 256 }, (_, index) => entity(`entity-${String(index).padStart(3, '0')}`));
    expect(projectEntityPoseReference(snapshot(atLimit), { publicationSequence: 0 }).entities).toHaveLength(256);
    expect(() =>
      projectEntityPoseReference(snapshot([...atLimit, entity('overflow')]), { publicationSequence: 0 }),
    ).toThrow(/256/);
  });

  it('拒绝重复 id、非法 type/archetype 组合与非法 grounded', () => {
    expect(() =>
      projectEntityPoseReference(snapshot([entity('same'), entity('same')]), { publicationSequence: 0 }),
    ).toThrow(/duplicate/i);
    expect(() =>
      projectEntityPoseReference(snapshot([entity('bad', { type: 'invalid' as never })]), { publicationSequence: 0 }),
    ).toThrow(/type/i);
    expect(() =>
      projectEntityPoseReference(snapshot([entity('bad', { type: 'player', archetype: 'grazer' })]), {
        publicationSequence: 0,
      }),
    ).toThrow(/archetype/i);
    expect(() =>
      projectEntityPoseReference(snapshot([entity('bad', { type: 'npc', archetype: 'grazer' })]), {
        publicationSequence: 0,
      }),
    ).toThrow(/archetype/i);
    expect(() =>
      projectEntityPoseReference(snapshot([entity('bad', { grounded: 'yes' as never })]), { publicationSequence: 0 }),
    ).toThrow(/grounded/i);
  });

  it.each([
    ['publicationSequence', snapshot(), { publicationSequence: Number.MAX_SAFE_INTEGER + 1 }],
    ['physicsTick', { ...snapshot(), physicsTick: -1 }, { publicationSequence: 0 }],
    ['commitSequence', { ...snapshot(), commitSequence: 1.5 }, { publicationSequence: 0 }],
    ['worldRevision', { ...snapshot(), worldRevision: Number.NaN }, { publicationSequence: 0 }],
  ])('拒绝非法安全整数 %s', (_field, source, context) => {
    expect(() => projectEntityPoseReference(source as AuthoritySnapshot, context)).toThrow(/safe integer/i);
  });

  it.each([
    ['position', { position: { x: Number.NaN, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 } }],
    ['velocity', { position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: Infinity, z: 6 } }],
  ])('拒绝非 finite %s 向量', (_field, body) => {
    expect(() => projectEntityPoseReference(snapshot([entity('bad', { body })]), { publicationSequence: 0 })).toThrow(
      /finite/i,
    );
  });
});
