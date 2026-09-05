import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ServerCommandExecutor } from '../../src/server/commands/server-command-executor';
import { GameServer } from '../../src/server/game-server';

const developer = {
  actorId: 'developer',
  sourceType: 'local-developer' as const,
  entityId: 'player',
  capabilities: ['query', 'mutation', 'administrative'] as const,
};

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('唯一权威会话推进边界', () => {
  it('服务端兼容门面不再公开旧 gameplay 物理推进器', () => {
    const server = new GameServer({ seedText: 'authority-only-advance' });
    expect('advanceGameplay' in server).toBe(false);
    expect(source('src/server/gameplay/gameplay-runtime.ts')).not.toMatch(/EntityPhysics|\bsimulation\.advance\(/);
    expect(source('src/server/simulation/autonomy-runtime.ts')).not.toMatch(/\badvanceMovement\(|\bentities\.move\(/);
    expect(() => source('src/server/gameplay/entity-physics.ts')).toThrow();
  });

  it('没有权威会话端口时拒绝 /tick，且不会偷偷推进旧规则时钟', async () => {
    const server = new GameServer({ seedText: 'authority-only-command' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const before = server.gameplayTime;

    await expect(
      new ServerCommandExecutor(server).execute(developer, { type: 'advance-gameplay', seconds: 1 }),
    ).resolves.toMatchObject({
      success: false,
      error: { kind: 'execution', code: 'COMMAND_EXECUTION_FAILED' },
    });
    expect(server.gameplayTime).toBe(before);
  });

  it('把 /tick 的秒参数原样交给显式权威会话端口', async () => {
    const server = new GameServer({ seedText: 'authority-command-port' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const advanceSession = vi.fn(() => ({
      physicsTick: 75,
      gameplayTime: 1.25,
      worldTime: 6.1,
      lanes: { physicsSteps: 75, gameplayPeriods: 25, fluidPeriods: 37 },
      commits: [],
    }));
    const executor = new ServerCommandExecutor(server, { advanceSession } as ConstructorParameters<
      typeof ServerCommandExecutor
    >[1]);

    await expect(executor.execute(developer, { type: 'advance-gameplay', seconds: 1.25 })).resolves.toMatchObject({
      success: true,
      data: {
        seconds: 1.25,
        physicsTick: 75,
        gameplayTime: 1.25,
        worldTime: 6.1,
        lanes: { physicsSteps: 75, gameplayPeriods: 25, fluidPeriods: 37 },
      },
    });
    expect(advanceSession).toHaveBeenCalledOnce();
    expect(advanceSession).toHaveBeenCalledWith(1.25);
  });
});
