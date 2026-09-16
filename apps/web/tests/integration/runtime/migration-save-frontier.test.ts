import { describe, expect, it } from 'vitest';
import { GameServer, classicOptions } from '../../fixtures/classic/content';
import { WorldResourceAuthorizer } from '../../../../../packages/stdlib/src/server/harness/world-authorization';
import { MemoryGamePersistence } from '../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';

const playerId = 'test-player';

function queueFlightSettlement(
  server: GameServer,
  resources: ReturnType<typeof classicOptions>['composition']['resources'],
) {
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: playerId }],
      rules: [
        { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['seedlands.mode'],
          operations: ['read', 'write', 'execute'],
          scope: 'self',
        },
      ],
    },
    resources,
  );
  const operations = server.bindModuleOperations(authorizer, {
    moduleId: 'seedlands:mode-module',
    principalId: 'human',
    originalActorId: playerId,
  });
  const queued = {
    operationId: 'seedlands:set-flight',
    target: { kind: 'entity' as const, entityId: playerId },
    input: { enabled: false },
  };
  const unsubscribe = operations.subscribe((_fact, enqueue) => {
    expect(enqueue(queued)).toBe(true);
    unsubscribe();
  });
  expect(
    operations.invoke({
      operationId: 'seedlands:set-mode',
      target: { kind: 'entity', entityId: playerId },
      input: { mode: 'creative' },
    }),
  ).toMatchObject({ ok: true });
  expect(server.getActorModeState(playerId)).toMatchObject({ mode: 'creative', flight: { enabled: true } });
}

describe('GameServer 保存 frontier', () => {
  it.each([
    ['ordinary', (server: GameServer) => server.freezeSaveSnapshot()],
    ['portable', (server: GameServer) => server.freezePortableSaveSnapshot()],
  ])('%s freeze closes queued Gameplay settlement before reading the Kernel frontier', async (_kind, freeze) => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const options = classicOptions();
    const server = new GameServer({
      platform: testCorePlatform,
      seedText: `migration-save-frontier:${_kind}`,
      persistence,
      ...options,
    });
    server.spawnPlayer({ id: playerId, position: [0.5, 34, 0.5] });
    queueFlightSettlement(server, options.composition.resources);
    const beforeFreeze = server.commitSequence;

    const frozen = freeze(server);

    expect(server.commitSequence).toBeGreaterThan(beforeFreeze);
    expect(frozen.commitSequence).toBe(server.commitSequence);
    expect(frozen.worldRevision).toBe(server.worldRevision);
    expect(frozen.gameplay.revision).toBe(server.gameplayRevision);
    expect(server.getActorModeState(playerId)).toMatchObject({ mode: 'creative', flight: { enabled: false } });

    await server.saveFrozen(frozen);
    const restored = new GameServer({
      platform: testCorePlatform,
      seedText: `migration-save-frontier:${_kind}`,
      persistence,
      ...classicOptions(),
    });
    await restored.restore();
    expect(restored.commitSequence).toBe(frozen.commitSequence);
    expect(restored.worldRevision).toBe(frozen.worldRevision);
    expect(restored.gameplayRevision).toBe(frozen.gameplay.revision);
    expect(restored.authorityExecution.commitSequence).toBe(frozen.commitSequence);
    expect(restored.getActorModeState(playerId)).toMatchObject({ mode: 'creative', flight: { enabled: false } });
    restored.disposeGameplay();
    server.disposeGameplay();
  });
});
