import { afterEach, describe, expect, it } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  createNodeAuthorityLane,
  type NodeAuthorityLaneOptions,
} from '../../apps/node-server/src/node/runtime/node-authority-lane';
import { DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS } from '../../apps/node-server/src/node/persistence/persistence-lane-protocol';

const rpcLimits = {
  maxRequests: 4,
  maxQueuedBytes: 1024,
  maxInFlightBytes: 1024,
  maxResponseBytes: 1024,
  maxReservedResponseBytes: 1024,
  maxConcurrentRequests: 1,
};
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function entry(source: string): Promise<URL> {
  const directory = await mkdtemp(resolve(tmpdir(), 'seedlands-authority-lane-'));
  directories.push(directory);
  const path = resolve(directory, 'authority-worker.mjs');
  await writeFile(path, source);
  return new URL(`file://${path}`);
}

function laneOptions(worker: URL): Readonly<{ options: NodeAuthorityLaneOptions; cleanupPort: MessagePort }> {
  const persistence = new MessageChannel();
  return {
    options: {
      entry: worker,
      epoch: 'authority-failure',
      seedText: 'authority-failure',
      generatorVersion: 1,
      persistencePort: persistence.port1,
      persistenceProxy: {
        identity: { worldId: 'default', seedText: 'authority-failure', generatorVersion: 1 },
        limits: DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS,
        rpcLimits,
        generation: 1,
      },
      controlRpcLimits: rpcLimits,
      computeMode: 'inline',
      computeEntries: {
        worker: new URL('file:///unused/node-compute-worker.js'),
        child: new URL('file:///unused/node-compute-child.js'),
      },
    },
    cleanupPort: persistence.port2,
  };
}

describe('Authority lane 故障可见性与物理清理', () => {
  it('Worker fatal 立即暴露 whenFailed，但 stop 等 cleanup-complete 后才结算', async () => {
    const worker = await entry(`
      import { parentPort } from 'node:worker_threads';
      parentPort.once('message', () => {
        parentPort.postMessage({ type: 'ready', diagnostics: {} });
        setTimeout(() => parentPort.postMessage({ type: 'fatal', error: 'simulated-fatal' }), 0);
        setTimeout(() => parentPort.postMessage({ type: 'cleanup-complete' }), 80);
        setInterval(() => {}, 1_000);
      });
    `);
    const lane = await createNodeAuthorityLane(laneOptions(worker).options);
    await expect(lane.whenFailed()).resolves.toMatchObject({ message: 'simulated-fatal' });
    let stopSettled = false;
    const stop = lane.stop();
    void stop.then(
      () => {
        stopSettled = true;
      },
      () => {
        stopSettled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopSettled).toBe(false);
    await expect(stop).rejects.toThrow('simulated-fatal');
    const exited = lane.whenExited();
    await expect(lane.close()).rejects.toThrow('simulated-fatal');
    await expect(exited).rejects.toThrow('simulated-fatal');
  });

  it('control close 先于 fatal 时不提前终止 Worker，已在途 stop 仍等 cleanup barrier 后拒绝', async () => {
    const worker = await entry(`
      import { parentPort } from 'node:worker_threads';
      parentPort.once('message', (bootstrap) => {
        parentPort.postMessage({ type: 'ready', diagnostics: {} });
        setTimeout(() => bootstrap.controlPort.close(), 0);
        parentPort.on('message', (request) => {
          if (request?.type !== 'fail') return;
          parentPort.postMessage({ type: 'fatal', error: request.error });
          parentPort.postMessage({ type: 'stopped', result: { status: 'stopped', durableCommitSequence: 7 } });
          bootstrap.persistencePort.postMessage({ type: 'cleanup-waiting' });
          bootstrap.persistencePort.on('message', (release) => {
            if (release?.type === 'release-cleanup') parentPort.postMessage({ type: 'cleanup-complete' });
          });
        });
        setInterval(() => {}, 1_000);
      });
    `);
    const fixture = laneOptions(worker);
    const waiting = new Promise<void>((resolve) => {
      fixture.cleanupPort.once('message', () => resolve());
    });
    const lane = await createNodeAuthorityLane(fixture.options);
    const failed = lane.whenFailed();
    let stopSettled = false;
    let exitSettled = false;
    const stop = lane.stop();
    void stop.then(
      () => {
        stopSettled = true;
      },
      () => {
        stopSettled = true;
      },
    );
    void lane.whenExited().then(
      () => {
        exitSettled = true;
      },
      () => {
        exitSettled = true;
      },
    );
    await expect(failed).resolves.toMatchObject({ message: expect.stringMatching(/closed/i) });
    expect(lane.state()).toBe('failed');
    await waiting;
    expect(stopSettled).toBe(false);
    expect(exitSettled).toBe(false);
    expect(lane.state()).toBe('failed');
    fixture.cleanupPort.postMessage({ type: 'release-cleanup' });
    await expect(stop).rejects.toThrow(/closed/i);
    expect(exitSettled).toBe(false);
    await expect(lane.close()).rejects.toThrow(/closed|exited/i);
  });

  it('畸形 publication 不能进入 latest 缓存，并请求 Worker 有序清理', async () => {
    const worker = await entry(`
      import { parentPort } from 'node:worker_threads';
      parentPort.once('message', (bootstrap) => {
        parentPort.postMessage({ type: 'ready', diagnostics: {} });
        setTimeout(() => bootstrap.publicationPort.postMessage({
          type: 'publication', epoch: bootstrap.options.epoch, sequence: 0, publication: { commits: [] },
        }), 0);
        let failed = false;
        parentPort.on('message', (request) => {
          if (failed || request?.type !== 'fail') return;
          failed = true;
          parentPort.postMessage({ type: 'fatal', error: request.error });
          parentPort.postMessage({ type: 'cleanup-complete' });
        });
        setInterval(() => {}, 1_000);
      });
    `);
    const lane = await createNodeAuthorityLane(laneOptions(worker).options);
    await expect(lane.whenFailed()).resolves.toMatchObject({ message: expect.stringMatching(/publication/i) });
    expect(lane.latestPublication()).toBeNull();
    await expect(lane.stop()).rejects.toThrow(/publication/i);
    const exited = lane.whenExited();
    await expect(lane.close()).rejects.toThrow(/publication|exited/i);
    await expect(exited).rejects.toThrow(/publication|exited/i);
  });
});
