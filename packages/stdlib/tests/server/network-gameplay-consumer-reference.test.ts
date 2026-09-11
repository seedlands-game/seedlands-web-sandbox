import { describe, expect, it } from 'vitest';
import { projectGameplayConsumerReference } from '../../src/server/protocol/network-gameplay-consumer-reference';
import type { AuthorityGameplayView } from '../../src/server/protocol/authority-worker-protocol';
import type { ActorBehavior, ActorState } from '../../src/server/simulation/actor-state';

const behaviors = [
  'idle',
  'wander',
  'seek-food',
  'flee',
  'chase',
  'attack',
  'routine-home',
  'routine-work',
] as const satisfies readonly ActorBehavior[];

const context = {
  epoch: 'host:gameplay-consumer-reference',
  snapshotPhysicsTick: 41,
  snapshotCommitSequence: 17,
  snapshotWorldRevision: 9,
} as const;

type SourceEntity = {
  id: string;
  type: 'player' | 'world-item' | 'creature' | 'npc';
  kind: 'player' | 'world-item' | 'creature' | 'npc';
  lifecycle: 'active';
  position: [number, number, number];
  physicsVelocity: [number, number, number];
  archetype?: 'grazer' | 'night-stalker' | 'settler';
  stack?: { itemId: string; count: number };
  health?: number;
  maxHealth?: number;
};

const entity = (id: string, type: SourceEntity['type'], archetype?: SourceEntity['archetype']): SourceEntity => ({
  id,
  type,
  kind: type,
  lifecycle: 'active',
  position: [1, 2, 3],
  physicsVelocity: [0, 0, 0],
  ...(archetype === undefined ? {} : { archetype }),
  ...(type === 'world-item' ? { stack: { itemId: 'berry', count: 2 } } : {}),
  ...(type === 'creature' || type === 'npc' ? { health: 12, maxHealth: 12 } : {}),
});

const actor = (
  entityId: string,
  behavior: ActorBehavior,
  archetype: 'grazer' | 'night-stalker' | 'settler' = 'grazer',
): ActorState => ({
  entityId,
  archetype,
  hunger: 0,
  behavior,
  targetEntityId: null,
  homePoiId: null,
  workPoiId: null,
  foodPoiId: null,
  active: true,
  attackCooldownSeconds: 0,
  wanderIndex: 0,
});

const view = (
  entities: SourceEntity[] = [
    entity('player-1', 'player'),
    entity('creature-a', 'creature', 'grazer'),
    entity('npc-b', 'npc', 'settler'),
    entity('item-c', 'world-item'),
  ],
  actors: ActorState[] = [actor('creature-a', 'wander'), actor('npc-b', 'routine-work', 'settler')],
): AuthorityGameplayView =>
  ({
    gameplayRevision: 12,
    gameplayTime: 3.5,
    player: {
      entityId: 'player-1',
      health: 20,
      maxHealth: 20,
      hunger: 20,
      maxHunger: 20,
      lifecycle: 'alive',
      inventory: Array.from({ length: 24 }, () => null),
      selectedSlot: 0,
      hotbarSize: 8,
      breakAction: null,
    },
    entities,
    actors,
    craftableRecipeIds: [],
    metrics: {},
  }) as unknown as AuthorityGameplayView;

describe('projectGameplayConsumerReference', () => {
  it.each(behaviors)('白名单行为 %s 可投影，并按 entityId 稳定排序及深复制', (behavior) => {
    const source = view(
      [entity('player-1', 'player'), entity('actor-z', 'creature', 'grazer')],
      [actor('actor-z', behavior)],
    );

    const projected = projectGameplayConsumerReference(source, context);

    expect(projected).toMatchObject({
      kind: 'gameplay-consumer-reference',
      projectionVersion: 2,
      actorBehaviors: [{ entityId: 'actor-z', behavior }],
    });
    expect(projected.actorBehaviors).not.toBe(source.actors);
    expect(projected.actorBehaviors[0]).not.toBe(source.actors[0]);
    source.actors[0]!.behavior = 'idle';
    source.entities[1]!.position[0] = 99;
    expect(projected.actorBehaviors).toEqual([{ entityId: 'actor-z', behavior }]);
    expect(projected.entities.find((candidate) => candidate.id === 'actor-z')?.position[0]).toBe(1);
  });

  it('只输出最小 actor allowlist，不泄漏内部 ActorState 字段', () => {
    const projected = projectGameplayConsumerReference(view(), context);

    expect(projected.actorBehaviors).toEqual([
      { entityId: 'creature-a', behavior: 'wander' },
      { entityId: 'npc-b', behavior: 'routine-work' },
    ]);
    expect(projected).not.toHaveProperty('actors');
    expect(projected.actorBehaviors[0]).not.toHaveProperty('hunger');
    expect(projected.actorBehaviors[0]).not.toHaveProperty('targetEntityId');
    expect(projected.actorBehaviors[0]).not.toHaveProperty('attackCooldownSeconds');
  });

  it('拒绝孤立 actor 与重复 actor entityId', () => {
    expect(() => projectGameplayConsumerReference(view(undefined, [actor('missing', 'idle')]), context)).toThrow(
      /actor.*entity/i,
    );
    expect(() =>
      projectGameplayConsumerReference(
        view(undefined, [actor('creature-a', 'idle'), actor('creature-a', 'wander')]),
        context,
      ),
    ).toThrow(/duplicate/i);
  });

  it.each([
    ['非法 behavior', view(undefined, [actor('creature-a', 'invalid' as never)]), /behavior/i],
    ['空 actor entityId', view(undefined, [actor('', 'idle')]), /entityId/i],
    ['稀疏 actor 数组', view(undefined, new Array<ActorState>(1)), /actor/i],
    [
      '重复 entityId',
      view(
        [
          entity('player-1', 'player'),
          entity('creature-a', 'creature', 'grazer'),
          entity('creature-a', 'creature', 'grazer'),
        ],
        [actor('creature-a', 'idle')],
      ),
      /duplicate.*entity/i,
    ],
    [
      '双方都缺 archetype',
      view(
        [entity('player-1', 'player'), entity('creature-a', 'creature')],
        [{ ...actor('creature-a', 'idle'), archetype: undefined as never }],
      ),
      /archetype/i,
    ],
  ] as const)('拒绝 %s', (_label, source, message) => {
    expect(() => projectGameplayConsumerReference(source, context)).toThrow(message);
  });

  it.each([
    ['world-item', entity('item-c', 'world-item'), actor('item-c', 'idle')],
    ['player', entity('player-1', 'player'), actor('player-1', 'idle')],
    ['archetype mismatch', entity('creature-a', 'creature', 'grazer'), actor('creature-a', 'idle', 'settler')],
  ] as const)('拒绝关联到错误实体类型或原型的 actor：%s', (_label, sourceEntity, sourceActor) => {
    expect(() => projectGameplayConsumerReference(view([sourceEntity], [sourceActor]), context)).toThrow(
      /actor|archetype|entity/i,
    );
  });
});
