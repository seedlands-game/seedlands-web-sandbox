import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodeServerRuntime,
  type NodeServerRuntime,
} from '../../apps/node-server/src/node/server/node-server-runtime';

const runtimeEntry = (name: string) => pathToFileURL(resolve(`apps/node-server/dist/${name}.js`));
const dataDirectories: string[] = [];
const runtimes: NodeServerRuntime[] = [];

afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.stop()));
  await Promise.all(dataDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Node playable runtime without a browser connection', () => {
  it('keeps the sole Authority physics clock advancing while no network session exists', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'seedlands-offline-tick-'));
    dataDirectories.push(dataDirectory);
    const runtime = await createNodeServerRuntime({
      dataDirectory,
      seedText: 'offline-tick-evidence',
      computeMode: 'inline',
      entries: {
        authority: runtimeEntry('node-authority-worker'),
        persistence: runtimeEntry('node-persistence-worker'),
        worker: runtimeEntry('node-compute-worker'),
        child: runtimeEntry('node-compute-child'),
      },
    });
    runtimes.push(runtime);

    const ready = await runtime.authority.readReady();
    const startTick = ready.snapshot.physicsTick;
    await expect
      .poll(() => runtime.authority.latestSnapshot()?.physicsTick ?? startTick, { timeout: 2_000, interval: 25 })
      .toBeGreaterThan(startTick + 10);
    expect(runtime.state).toBe('running');
  });
});
