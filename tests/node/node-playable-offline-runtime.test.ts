import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createNodeServerRuntime,
  type NodeServerRuntime,
} from '../../apps/node-server/src/node/server/node-server-runtime';
import { buildNodeServerArtifactFixture } from './support/node-server-artifact-fixture';

const dataDirectories: string[] = [];
const runtimes: NodeServerRuntime[] = [];
let artifact: Awaited<ReturnType<typeof buildNodeServerArtifactFixture>>;

beforeAll(async () => {
  artifact = await buildNodeServerArtifactFixture('seedlands-offline-artifact-');
});

afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.stop()));
  await Promise.all(dataDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

afterAll(async () => {
  if (typeof artifact !== 'undefined') await artifact.close();
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
        authority: artifact.entry('node-authority-worker'),
        persistence: artifact.entry('node-persistence-worker'),
        worker: artifact.entry('node-compute-worker'),
        child: artifact.entry('node-compute-child'),
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
