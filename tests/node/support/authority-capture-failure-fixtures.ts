import { existsSync, watch } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';
import { createNodeAuthorityLane, type NodeAuthorityLane } from '../../../src/node/runtime/node-authority-lane';
import { createNodePersistenceLane } from '../../../src/node/persistence/node-persistence-lane';
import { GENERATOR_VERSION } from '../../../src/world/voxel';

type Mode = 'normal' | 'early-cleanup-negative-control';
type Artifacts = Readonly<{ authority: URL; persistence: URL; compute: URL; child: URL; directory: string }>;

export type AuthorityCaptureFailureFixture = Readonly<{
  lane: NodeAuthorityLane;
  captureRequest: Readonly<{ captureId: number; purpose: 'mesh'; key: string; minimumRevision: number }>;
  waitForComputeAcceptance(): Promise<void>;
  closeControl(): Promise<void>;
  waitForFatalForwarded(): Promise<void>;
  confirmStopPending(): Promise<void>;
  releaseCompute(): Promise<void>;
  settlementBeforeRelease(stop: Promise<unknown>): Promise<'released' | 'settled'>;
  wasComputeReleased(): boolean;
  exitSettled(): boolean;
  closePersistenceAndVerifyReopen(): Promise<void>;
  teardownInner(): Promise<void>;
  dispose(): Promise<void>;
}>;

let artifacts: Promise<Artifacts> | undefined;
let fixtureCounter = 0;

function watchFor(path: string, deadlineMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let watcher: ReturnType<typeof watch> | undefined;
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error(`Timed out waiting for fixture marker: ${basename(path)}.`)),
      deadlineMs,
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      if (error) reject(error);
      else resolve();
    };
    try {
      // 先注册目录 watcher，后读取存在状态，避免写入发生在两步之间时漏掉事件。
      watcher = watch(dirname(path), (_event, changed) => {
        if ((!changed || changed.toString() === basename(path)) && existsSync(path)) finish();
      });
      if (existsSync(path)) finish();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function buildArtifacts(): Promise<Artifacts> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-authority-capture-failure-build-'));
  const build = async (source: string, name: string) => {
    await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: source,
        outDir: join(directory, name),
        emptyOutDir: true,
        target: 'node22',
        rollupOptions: { output: { entryFileNames: `${name}.mjs` } },
      },
    });
    return pathToFileURL(join(directory, name, `${name}.mjs`));
  };
  const [authority, persistence, compute, child] = await Promise.all([
    build('src/node/server/node-authority-worker.ts', 'authority'),
    build('src/node/persistence/node-persistence-worker.ts', 'persistence'),
    build('src/node/compute/node-compute-worker.ts', 'compute'),
    build('src/node/compute/node-compute-child.ts', 'child'),
  ]);
  return { authority, persistence, compute, child, directory };
}

async function getArtifacts(): Promise<Artifacts> {
  artifacts ??= buildArtifacts();
  return artifacts;
}

export async function disposeAuthorityCaptureFailureArtifacts(): Promise<void> {
  if (!artifacts) return;
  const built = await artifacts;
  artifacts = undefined;
  await rm(built.directory, { recursive: true, force: true });
}

const bridgeSource = `
import { Worker, MessageChannel, parentPort } from 'node:worker_threads';
import { existsSync, watch, writeFileSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
if (!parentPort) throw new Error('bridge needs parentPort');
const config = JSON.parse(readFileSync(new URL('./authority-capture-failure-bridge.json', import.meta.url)));
const buffers = (value, seen = new WeakSet(), out = new Set()) => {
  if (value instanceof ArrayBuffer) out.add(value);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) buffers(item, seen, out);
  }
  return [...out];
};
const post = (port, value) => {
  const transfer = buffers(value);
  port.postMessage(value, transfer.length ? transfer : undefined);
};
const watchFor = (path, action) => {
  let done = false;
  let watcher;
  const fire = () => {
    if (done) return;
    done = true;
    watcher?.close();
    action();
  };
  watcher = watch(dirname(path), (_event, changed) => {
    if ((!changed || changed.toString() === basename(path)) && existsSync(path)) fire();
  });
  if (existsSync(path)) fire();
};
parentPort.once('message', (bootstrap) => {
  const inner = new Worker(new URL(config.innerEntry));
  const control = new MessageChannel();
  let innerTeardown = false;
  let cleanupForwarded = false;
  bootstrap.controlPort.on('message', (value) => post(control.port1, value));
  control.port1.on('message', (value) => post(bootstrap.controlPort, value));
  inner.on('message', (value) => {
    if (value?.type === 'fatal') {
      parentPort.postMessage(value);
      writeFileSync(config.fatalForwarded, 'fatal forwarded');
      if (config.negative) {
        writeFileSync(config.earlyCleanup, 'fixture-only early cleanup');
        cleanupForwarded = true;
        parentPort.postMessage({ type: 'cleanup-complete' });
      }
      return;
    }
    if (value?.type === 'cleanup-complete') cleanupForwarded = true;
    parentPort.postMessage(value);
  });
  inner.on('exit', () => {
    if (innerTeardown) writeFileSync(config.innerExited, 'inner exited');
  });
  parentPort.on('message', (value) => {
    if (value?.type !== 'fail') return;
    inner.postMessage(value);
    writeFileSync(config.failForwarded, 'fail forwarded');
  });
  watchFor(config.stopProbe, () => {
    if (!cleanupForwarded) writeFileSync(config.stopPending, 'cleanup has not been forwarded');
  });
  watchFor(config.closeControl, () => {
    bootstrap.controlPort.close();
    control.port1.close();
    writeFileSync(config.controlClosed, 'control closed');
  });
  watchFor(config.teardownInner, () => {
    innerTeardown = true;
    void inner.terminate().then(() => writeFileSync(config.innerExited, 'inner terminated'));
  });
  inner.postMessage({ ...bootstrap, controlPort: control.port2 }, [control.port2, bootstrap.publicationPort, bootstrap.persistencePort]);
});
`;

const computeGateSource = `
import { Worker, parentPort } from 'node:worker_threads';
import { existsSync, watch, writeFileSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
if (!parentPort) throw new Error('compute gate needs parentPort');
const config = JSON.parse(readFileSync(new URL('./authority-capture-failure-compute.json', import.meta.url)));
const buffers = (value, seen = new WeakSet(), out = new Set()) => {
  if (value instanceof ArrayBuffer) out.add(value);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) buffers(item, seen, out);
  }
  return [...out];
};
const post = (port, value) => {
  const transfer = buffers(value);
  port.postMessage(value, transfer.length ? transfer : undefined);
};
const waitFor = (path) => new Promise((resolve) => {
  let done = false;
  let watcher;
  const finish = () => {
    if (done) return;
    done = true;
    watcher?.close();
    resolve();
  };
  watcher = watch(dirname(path), (_event, changed) => {
    if ((!changed || changed.toString() === basename(path)) && existsSync(path)) finish();
  });
  if (existsSync(path)) finish();
});
const inner = new Worker(new URL(config.innerEntry));
inner.on('message', (value) => post(parentPort, value));
parentPort.on('close', () => void inner.terminate());
process.once('exit', () => void inner.terminate());
parentPort.on('message', async (value) => {
  const task = value?.kind === 'run-dedicated-compute' ? value.task : undefined;
  if (existsSync(config.enableGate) && task?.kind === 'generate-canonical' && task.key === config.targetKey) {
    writeFileSync(config.computeAccepted, JSON.stringify({ key: task.key, taskId: task.taskId }));
    await waitFor(config.releaseCompute);
  }
  post(inner, value);
});
`;

export async function createAuthorityCaptureFailureFixture(mode: Mode): Promise<AuthorityCaptureFailureFixture> {
  const built = await getArtifacts();
  const root = await mkdtemp(join(tmpdir(), 'seedlands-authority-capture-control-'));
  const world = join(root, 'world');
  const captureRequest = { captureId: 0, purpose: 'mesh' as const, key: '40,1,0', minimumRevision: 0 };
  const names = {
    enableGate: join(root, 'enable-gate'),
    computeAccepted: join(root, 'compute-accepted'),
    releaseCompute: join(root, 'release-compute'),
    closeControl: join(root, 'close-control'),
    controlClosed: join(root, 'control-closed'),
    teardownInner: join(root, 'teardown-inner'),
    innerExited: join(root, 'inner-exited'),
    earlyCleanup: join(root, 'early-cleanup'),
    failForwarded: join(root, 'fail-forwarded'),
    fatalForwarded: join(root, 'fatal-forwarded'),
    stopProbe: join(root, 'stop-probe'),
    stopPending: join(root, 'stop-pending'),
  };
  const bridgeEntry = join(root, 'authority-capture-failure-bridge.mjs');
  const computeEntry = join(root, 'authority-capture-failure-compute.mjs');
  await Promise.all([
    writeFile(bridgeEntry, bridgeSource),
    writeFile(computeEntry, computeGateSource),
    writeFile(
      join(root, 'authority-capture-failure-bridge.json'),
      JSON.stringify({
        innerEntry: built.authority.href,
        closeControl: names.closeControl,
        controlClosed: names.controlClosed,
        teardownInner: names.teardownInner,
        innerExited: names.innerExited,
        earlyCleanup: names.earlyCleanup,
        failForwarded: names.failForwarded,
        fatalForwarded: names.fatalForwarded,
        stopProbe: names.stopProbe,
        stopPending: names.stopPending,
        negative: mode === 'early-cleanup-negative-control',
      }),
    ),
    writeFile(
      join(root, 'authority-capture-failure-compute.json'),
      JSON.stringify({
        innerEntry: built.compute.href,
        targetKey: captureRequest.key,
        enableGate: names.enableGate,
        computeAccepted: names.computeAccepted,
        releaseCompute: names.releaseCompute,
      }),
    ),
  ]);
  const epoch = `authority-capture-control-${fixtureCounter++}`;
  let persistence: Awaited<ReturnType<typeof createNodePersistenceLane>> | undefined;
  let lane: NodeAuthorityLane | undefined;
  try {
    persistence = await createNodePersistenceLane({
      entry: built.persistence,
      epoch,
      store: { directory: world, seedText: epoch, generatorVersion: GENERATOR_VERSION },
    });
    lane = await createNodeAuthorityLane({
      entry: pathToFileURL(bridgeEntry),
      epoch,
      seedText: epoch,
      generatorVersion: GENERATOR_VERSION,
      persistencePort: persistence.authorityPort,
      persistenceProxy: persistence.proxy,
      computeMode: 'worker-thread',
      computeEntries: { worker: pathToFileURL(computeEntry), child: built.child },
      hostLimits: { saveIntervalMs: 60_000 },
    });
    await writeFile(names.enableGate, 'enabled');
  } catch (error) {
    const failures = [error];
    if (lane) await lane.close().catch((cleanupError: unknown) => failures.push(cleanupError));
    if (persistence) await persistence.close().catch((cleanupError: unknown) => failures.push(cleanupError));
    await rm(root, { recursive: true, force: true }).catch((cleanupError: unknown) => failures.push(cleanupError));
    throw new AggregateError(failures, 'Authority capture failure fixture initialization failed.', { cause: error });
  }
  let released = false;
  let persistenceClosed = false;
  let innerTornDown = false;
  let disposed = false;
  let exited = false;
  const activeLane = lane;
  const activePersistence = persistence;
  if (!activeLane || !activePersistence) throw new Error('Fixture initialization did not produce active lanes.');
  void activeLane.whenExited().then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    },
  );
  return {
    lane: activeLane,
    captureRequest,
    waitForComputeAcceptance: () => watchFor(names.computeAccepted),
    closeControl: async () => {
      await writeFile(names.closeControl, 'close');
      await watchFor(names.controlClosed);
    },
    waitForFatalForwarded: () => watchFor(names.fatalForwarded),
    confirmStopPending: async () => {
      const waiting = watchFor(names.stopPending);
      await writeFile(names.stopProbe, 'probe');
      await waiting;
    },
    releaseCompute: async () => {
      if (!released) {
        const waiting = watchFor(names.releaseCompute);
        await writeFile(names.releaseCompute, 'release');
        await waiting;
        released = true;
      }
    },
    settlementBeforeRelease: (stop) =>
      Promise.race([
        stop.then(
          () => 'settled' as const,
          () => 'settled' as const,
        ),
        watchFor(names.releaseCompute).then(() => 'released' as const),
      ]),
    wasComputeReleased: () => released,
    exitSettled: () => exited,
    closePersistenceAndVerifyReopen: async () => {
      if (!persistenceClosed) {
        await activePersistence.close();
        persistenceClosed = true;
      }
      const reopened = await createNodePersistenceLane({
        entry: built.persistence,
        epoch: `${epoch}-reopen`,
        store: { directory: world, seedText: epoch, generatorVersion: GENERATOR_VERSION },
      });
      await reopened.close();
    },
    teardownInner: async () => {
      if (innerTornDown) return;
      const waiting = watchFor(names.innerExited);
      await writeFile(names.teardownInner, 'teardown');
      await waiting;
      innerTornDown = true;
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];
      try {
        await writeFile(names.releaseCompute, 'release');
        released = true;
      } catch (error) {
        failures.push(new Error('Could not release the controlled compute gate.', { cause: error }));
      }
      try {
        await activeLane.stop();
      } catch (error) {
        if (activeLane.state() !== 'failed')
          failures.push(new Error('Authority lane stop failed during fixture cleanup.', { cause: error }));
      }
      if (!persistenceClosed) {
        try {
          await activePersistence.close();
          persistenceClosed = true;
        } catch (error) {
          failures.push(new Error('Persistence lane close failed during fixture cleanup.', { cause: error }));
        }
      }
      if (!innerTornDown) {
        try {
          const waiting = watchFor(names.innerExited);
          await writeFile(names.teardownInner, 'teardown');
          await waiting;
          innerTornDown = true;
        } catch (error) {
          failures.push(new Error('Inner Authority Worker teardown failed.', { cause: error }));
        }
      }
      try {
        await activeLane.close();
      } catch (error) {
        if (activeLane.state() !== 'failed')
          failures.push(new Error('Authority lane close failed during fixture cleanup.', { cause: error }));
      } finally {
        try {
          await rm(root, { recursive: true, force: true });
        } catch (error) {
          failures.push(new Error('Fixture temporary directory cleanup failed.', { cause: error }));
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Authority capture failure fixture cleanup failed.');
    },
  };
}
