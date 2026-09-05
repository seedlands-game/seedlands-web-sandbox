import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('headless server command CLI', () => {
  it('runs a JSON-line command workflow without browser globals and survives invalid input', () => {
    const run = spawnSync('pnpm', ['--silent', 'server:headless', '--', '--seed', 'command-cli-test', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: ['/setblock 1 -20 1 wood', '/inspect voxel 1 -20 1', '/unknown', '/save', '/seed', ''].join('\n'),
      env: { ...process.env, CI: 'true' },
    });

    expect(run.status, run.stderr).toBe(0);
    const output = run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(output).toHaveLength(5);
    expect(output[0]).toMatchObject({ success: true, worldRevision: 1 });
    expect(output[1]).toMatchObject({ success: true, data: { voxel: 4 } });
    expect(output[2]).toMatchObject({ success: false, error: { kind: 'parse' } });
    expect(output[3]).toMatchObject({ success: true, data: { savedChunks: ['0,-1,0'] } });
    expect(output[4]).toMatchObject({ success: true, data: { seedText: 'command-cli-test' } });
  });

  it('drives all starter actor archetypes through the headless observation and action surface', () => {
    const run = spawnSync('pnpm', ['--silent', 'server:headless', '--', '--seed', 'actor-cli-test', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: [
        '/summon grazer 1 34 1',
        '/summon night-stalker 2 34 1',
        '/summon settler 3 34 1',
        '/observe creature-2',
        '/entity move creature-2 4 34 1',
        '/entity action creature-2',
        '/entity stop creature-2',
        '/path creature-2 5 34 1',
        '/poi nearby creature-2 10',
        '',
      ].join('\n'),
      env: { ...process.env, CI: 'true' },
    });

    expect(run.status, run.stderr).toBe(0);
    const output = run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { success: boolean; data?: Record<string, unknown> });
    expect(output).toHaveLength(9);
    expect(output.every((result) => result.success)).toBe(true);
    expect(output[0]).toMatchObject({ data: { entity: { archetype: 'grazer' } } });
    expect(output[1]).toMatchObject({ data: { entity: { archetype: 'night-stalker' } } });
    expect(output[2]).toMatchObject({ data: { entity: { archetype: 'settler', type: 'npc' } } });
    expect(output[5]).toMatchObject({ data: { action: { actorId: 'creature-2', status: 'pending' } } });
  });

  it('maps legacy tick seconds to the shared multi-rate Authority scheduler', () => {
    const run = spawnSync('pnpm', ['--silent', 'server:headless', '--', '--seed', 'tick-cli-test', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: '/tick 1\n',
      env: { ...process.env, CI: 'true' },
    });

    expect(run.status, run.stderr).toBe(0);
    const output = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    expect(output).toMatchObject({
      success: true,
      data: {
        seconds: 1,
        elapsedMs: 1_000,
        lanes: { physicsSteps: 60, gameplayPeriods: 20, fluidPeriods: 30 },
      },
    });
  });
});
