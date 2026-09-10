import { GameServer } from '../../packages/game-core/src/server/game-server';
import {
  ServerCommandExecutor,
  ALL_COMMAND_CAPABILITIES,
} from '../../packages/game-core/src/server/commands/server-command-executor';
import { testCorePlatform } from '../support/core-platform';
import { expect, it } from 'vitest';
import {
  meleeShowcaseCommands,
  createMeleeShowcaseIds,
  MELEE_SHOWCASE_DUMMY_IDS,
  MELEE_SHOWCASE_ENTITY_IDS,
} from '../../apps/web/src/app/gameplay/melee-action-showcase';

it('体验场只清理所属目标并在夜间重建三只静止目标与一只真实敌人', () => {
  const ids = createMeleeShowcaseIds('11111111-1111-4111-8111-111111111111');
  const commands = meleeShowcaseCommands(new Set([MELEE_SHOWCASE_DUMMY_IDS[1], 'unrelated-creature']), ids);
  expect(commands[0]).toEqual({ type: 'despawn-entity', entityId: MELEE_SHOWCASE_DUMMY_IDS[1] });
  expect(commands).not.toContainEqual({ type: 'despawn-entity', entityId: 'unrelated-creature' });
  expect(commands.filter((command) => command.type === 'spawn-creature').map((command) => command.id)).toEqual([
    ...ids.dummies,
  ]);
  expect(commands).toContainEqual(
    expect.objectContaining({ type: 'spawn-actor', id: ids.hostile, archetype: 'night-stalker' }),
  );
  expect(new Set(MELEE_SHOWCASE_ENTITY_IDS).size).toBe(4);
  expect(commands).toContainEqual({ type: 'time-set', hours: 22 });
  expect(commands).toContainEqual({ type: 'teleport', position: [0.5, 57, 0.5] });
  expect(commands).toContainEqual({ type: 'heal', amount: 20 });
});

it('重复布置使用新的场景身份，清理仅限准确的角色与规范 nonce', () => {
  const first = createMeleeShowcaseIds('11111111-1111-4111-8111-111111111111');
  const next = createMeleeShowcaseIds('22222222-2222-4222-8222-222222222222');
  const unrelated = 'showcase-dummy-left--custom-user-entity';
  const commands = meleeShowcaseCommands(new Set([...first.dummies, first.hostile, unrelated]), next);
  expect(commands.filter((command) => command.type === 'despawn-entity').map((command) => command.entityId)).toEqual([
    ...first.dummies,
    first.hostile,
  ]);
  expect(commands.filter((command) => command.type === 'spawn-creature').map((command) => command.id)).toEqual(
    next.dummies,
  );
  expect(commands).not.toContainEqual({ type: 'despawn-entity', entityId: unrelated });
  expect(() => createMeleeShowcaseIds('not-a-uuid')).toThrow();
});

it('真实 ECS 在两次体验场布置后保持旧引用失效且新目标可用', async () => {
  const server = new GameServer({ seedText: 'showcase-identities', platform: testCorePlatform });
  server.spawnPlayer({ id: 'player', position: [0.5, 57, 0.5] });
  const execute = new ServerCommandExecutor(server, { now: testCorePlatform.now });
  const source = {
    actorId: 'fixture',
    entityId: 'player',
    sourceType: 'developer',
    capabilities: ALL_COMMAND_CAPABILITIES,
  };
  const first = createMeleeShowcaseIds('11111111-1111-4111-8111-111111111111');
  const second = createMeleeShowcaseIds('22222222-2222-4222-8222-222222222222');
  for (const command of meleeShowcaseCommands(new Set(), first))
    expect(await execute.execute(source, command)).toMatchObject({ success: true });
  const reference = server.createEntityReference(first.dummies[1])!;
  for (const command of meleeShowcaseCommands(new Set(server.queryEntities().map((entity) => entity.id)), second))
    expect(await execute.execute(source, command)).toMatchObject({ success: true });
  expect(server.resolveEntityReference(reference)).toBeNull();
  expect(server.getEntity(second.dummies[1])).toMatchObject({ health: 12 });
  expect(server.getEntity(first.dummies[1])).toBeNull();
});
