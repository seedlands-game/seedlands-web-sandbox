import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';

type JsonCommandResult = { success: boolean; worldRevision?: number; data?: Record<string, unknown> };

const withInteractiveCli = async <Result>(
  seed: string,
  execute: (send: (command: string) => Promise<JsonCommandResult>) => Promise<Result>,
): Promise<Result> => {
  const child = spawn('pnpm', ['--silent', 'server:headless', '--', '--seed', seed, '--json'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, CI: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const send = async (command: string) => {
    child.stdin.write(`${command}\n`);
    const line = await lines.next();
    if (line.done) throw new Error(`Headless CLI closed before replying to ${command}: ${stderr}`);
    return JSON.parse(line.value) as JsonCommandResult;
  };
  const result = await execute(send);
  child.stdin.end();
  const [status] = (await once(child, 'close')) as [number | null];
  expect(status, stderr).toBe(0);
  return result;
};

describe('headless server command CLI', () => {
  it('runs a JSON-line command workflow without browser globals and survives invalid input', () => {
    const run = spawnSync('pnpm', ['--silent', 'server:headless', '--', '--seed', 'command-cli-test', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: ['/seed', '/setblock 1 -20 1 wood', '/inspect voxel 1 -20 1', '/unknown', '/save', '/seed', ''].join('\n'),
      env: { ...process.env, CI: 'true' },
    });

    expect(run.status, run.stderr).toBe(0);
    const output = run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(output).toHaveLength(6);
    const initialRevision = Number(output[0].worldRevision);
    expect(output[0]).toMatchObject({ success: true });
    expect(output[1]).toMatchObject({ success: true, worldRevision: initialRevision + 1 });
    expect(output[2]).toMatchObject({ success: true, data: { voxel: 4 } });
    expect(output[3]).toMatchObject({ success: false, error: { kind: 'parse' } });
    expect(output[4]).toMatchObject({ success: true });
    expect((output[4].data as { savedChunks: string[] }).savedChunks).toEqual(expect.arrayContaining(['0,-1,0']));
    expect(output[5]).toMatchObject({ success: true, data: { seedText: 'command-cli-test' } });
  }, 15_000);

  it('drives all starter actor archetypes through the headless observation and action surface', async () => {
    const { output, actorId } = await withInteractiveCli('actor-cli-test', async (send) => {
      const grazer = await send('/summon grazer 1 34 1');
      const nightStalker = await send('/summon night-stalker 2 34 1');
      const settler = await send('/summon settler 3 34 1');
      const actorId = String((grazer.data?.entity as { id?: unknown } | undefined)?.id ?? '');
      expect(actorId).not.toBe('');
      return {
        actorId,
        output: [
          grazer,
          nightStalker,
          settler,
          await send(`/observe ${actorId}`),
          await send(`/entity move ${actorId} 4 34 1`),
          await send(`/entity action ${actorId}`),
          await send(`/entity stop ${actorId}`),
          await send(`/path ${actorId} 5 34 1`),
          await send(`/poi nearby ${actorId} 10`),
        ],
      };
    });
    expect(output).toHaveLength(9);
    expect(output.every((result) => result.success)).toBe(true);
    expect(output[0]).toMatchObject({ data: { entity: { archetype: 'grazer' } } });
    expect(output[1]).toMatchObject({ data: { entity: { archetype: 'night-stalker' } } });
    expect(output[2]).toMatchObject({ data: { entity: { archetype: 'settler', type: 'npc' } } });
    expect(output[5]).toMatchObject({ data: { action: { actorId, status: 'pending' } } });
  }, 15_000);

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
  }, 15_000);

  it('keeps a plain legacy creature command valid through the next authority tick', () => {
    const run = spawnSync('pnpm', ['--silent', 'server:headless', '--', '--seed', 'plain-creature-test', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: ['/spawn creature 1 34 1', '/tick 0.1', ''].join('\n'),
      env: { ...process.env, CI: 'true' },
    });

    expect(run.status, run.stderr).toBe(0);
    const output = run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonCommandResult);
    expect(output).toHaveLength(2);
    expect(output[0]).toMatchObject({ success: true, data: { entity: { archetype: 'grazer' } } });
    expect(output[1]).toMatchObject({ success: true, data: { lanes: { physicsSteps: 6 } } });
  }, 15_000);
});
