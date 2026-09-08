import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodeDedicatedRuntime,
  type NodeDedicatedRuntime,
} from '../../apps/node-server/src/node/runtime/node-dedicated-runtime';
import { FileGamePersistence } from '../../apps/node-server/src/node/persistence/file-game-persistence';
import { PROTOCOL_VERSION } from '../../packages/game-core/src/runtime/session-protocol';
import { GENERATOR_VERSION, Voxel } from '../../packages/game-core/src/world/voxel';

const directories: string[] = [];

async function temporaryWorld(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-node-runtime-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('等待 Node runtime 状态超时。');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function create(dataDirectory: string, seedText: string, now?: () => number): Promise<NodeDedicatedRuntime> {
  return createNodeDedicatedRuntime({
    seedText,
    dataDirectory,
    computeMode: 'inline',
    now,
    wakeIntervalMs: 5,
  });
}

describe('Node dedicated runtime', { timeout: 30_000 }, () => {
  it('无需客户端 wake 即按真实 timer 推进权威时间，并在 500ms 后清空输入', async () => {
    const dataDirectory = await temporaryWorld();
    let now = 0;
    const runtime = await create(dataDirectory, 'autonomous-clock', () => now);
    const before = runtime.host.snapshot.physicsTick;
    now = 100;
    await waitFor(() => runtime.host.snapshot.physicsTick > before);
    expect(runtime.host.runtime.server.worldTime).toBeGreaterThan(9);

    const targetPhysicsTick = runtime.host.snapshot.physicsTick + 1;
    expect(
      runtime.host.receiveInput({
        kind: 'input',
        protocolVersion: PROTOCOL_VERSION,
        epoch: runtime.epoch,
        stream: 'player-input',
        sequence: 0,
        targetPhysicsTick,
        issuedAtMs: now,
        state: { moveX: 1, moveZ: 0, verticalIntent: 1, jumpHeld: true },
        edges: { jumpPressed: true },
      }),
    ).toBe('accepted');
    now = 601;
    await waitFor(() => runtime.host.diagnostics().inputLeaseExpired);
    expect(runtime.host.snapshot.paused).toBe(false);
    expect(runtime.host.snapshot.player.body.velocity.x).toBe(0);
    await runtime.stop();
  });

  it('最终保存后释放锁，重启使用新 epoch 恢复同一世界检查点和 Chunk', async () => {
    const dataDirectory = await temporaryWorld();
    const first = await create(dataDirectory, 'restart-world');
    first.host.runtime.server.edit(0, 20, 0, Voxel.Wood);
    const firstEpoch = first.epoch;
    const stopped = await first.stop();
    expect(stopped.status).toBe('stopped');
    expect(stopped.durableCommitSequence).toBeGreaterThanOrEqual(0);

    const second = await create(dataDirectory, 'restart-world');
    expect(second.epoch).not.toBe(firstEpoch);
    expect(second.host.runtime.server.worldRevision).toBeGreaterThanOrEqual(1);
    const restored = second.host.requestChunk('0,0,0');
    await second.host.waitForIdle();
    expect(await restored).toBe(true);
    expect(second.host.runtime.server.getVoxel(0, 20, 0)).toBe(Voxel.Wood);
    await second.stop();
  });

  it('同目录双开 fail closed，原实例停止后可重新创建', async () => {
    const dataDirectory = await temporaryWorld();
    const first = await create(dataDirectory, 'exclusive-runtime');
    await expect(create(dataDirectory, 'exclusive-runtime')).rejects.toThrow(/锁|lock|writer/i);
    expect(first.state).toBe('running');
    await first.stop();
    const replacement = await create(dataDirectory, 'exclusive-runtime');
    await replacement.stop();
  });

  it('stop 幂等，停止 timer 后完成最终 durable 保存再释放目录锁', async () => {
    const dataDirectory = await temporaryWorld();
    const runtime = await create(dataDirectory, 'idempotent-stop');
    runtime.host.runtime.server.edit(0, 20, 0, Voxel.Lantern);
    const terminal = runtime.whenStopped();
    let terminalSettled = false;
    void terminal.finally(() => {
      terminalSettled = true;
    });
    await Promise.resolve();
    expect(terminalSettled).toBe(false);
    const first = runtime.stop();
    const second = runtime.stop();
    expect(second).toBe(first);
    const result = await first;
    await expect(terminal).resolves.toEqual(result);
    expect(result).toMatchObject({ status: 'stopped' });
    expect(runtime.state).toBe('stopped');
    expect(runtime.host.diagnostics().durableCommitSequence).toBe(result.durableCommitSequence);

    const store = await FileGamePersistence.open({
      directory: dataDirectory,
      seedText: 'idempotent-stop',
      generatorVersion: GENERATOR_VERSION,
    });
    expect(store.loadGameCheckpoint()?.commitSequence).toBe(result.durableCommitSequence);
    await store.close();
  });

  it('移动中的玩家已保存后立即 stop，清输入产生的新权威状态仍形成新检查点', async () => {
    const dataDirectory = await temporaryWorld();
    let now = 0;
    const runtime = await create(dataDirectory, 'stop-after-moving-save', () => now);
    await runtime.host.waitForIdle();
    const targetPhysicsTick = runtime.host.snapshot.physicsTick + 1;
    expect(
      runtime.host.receiveInput({
        kind: 'input',
        protocolVersion: PROTOCOL_VERSION,
        epoch: runtime.epoch,
        stream: 'player-input',
        sequence: 0,
        targetPhysicsTick,
        issuedAtMs: now,
        state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
        edges: { jumpPressed: false },
      }),
    ).toBe('accepted');
    now = 100;
    runtime.host.wake(now);
    expect(runtime.host.snapshot.player.body.velocity.x).not.toBe(0);
    const saved = await runtime.host.save();

    const stopped = await runtime.stop();
    expect(stopped.durableCommitSequence).toBeGreaterThan(saved.commitSequence);

    const store = await FileGamePersistence.open({
      directory: dataDirectory,
      seedText: 'stop-after-moving-save',
      generatorVersion: GENERATOR_VERSION,
    });
    const gameplay = store.loadGameplaySnapshot() as {
      entities: Array<{ id: string; physicsVelocity?: [number, number, number] }>;
    };
    expect(gameplay.entities.find((entity) => entity.id === runtime.host.runtime.playerId)?.physicsVelocity?.[0]).toBe(
      0,
    );
    await store.close();
  });

  it('compute 启动失败时关闭已创建 executors 并释放文件存储锁', async () => {
    const dataDirectory = await temporaryWorld();
    const missing = pathToFileURL(join(dataDirectory, 'missing-compute-entry.mjs'));
    await expect(
      createNodeDedicatedRuntime({
        seedText: 'startup-cleanup',
        dataDirectory,
        computeMode: 'worker-thread',
        computeEntries: { worker: missing, child: missing },
      }),
    ).rejects.toThrow();

    const recovered = await create(dataDirectory, 'startup-cleanup');
    await recovered.stop();
  });

  it('存储启动失败不会创建可运行宿主，也不影响现有实例最终保存', async () => {
    const dataDirectory = await temporaryWorld();
    const first = await create(dataDirectory, 'store-startup-failure');
    const checkpoint = first.host.diagnostics().durableCommitSequence;
    await expect(create(dataDirectory, 'store-startup-failure')).rejects.toThrow();
    expect(first.state).toBe('running');
    expect(first.host.diagnostics().durableCommitSequence).toBe(checkpoint);
    await first.stop();
  });

  it('自动保存失败会清输入、拒绝新写入并主动结束 runtime', async () => {
    const dataDirectory = await temporaryWorld();
    let now = 0;
    const runtime = await createNodeDedicatedRuntime({
      seedText: 'automatic-save-failure',
      dataDirectory,
      computeMode: 'inline',
      now: () => now,
      wakeIntervalMs: 5,
      hostLimits: { saveIntervalMs: 1 },
      persistenceLimits: { maxGameplayBytes: 1 },
    });
    now = 10;

    await expect(runtime.whenStopped()).rejects.toThrow(/Gameplay.*上限|host failed|shutdown failed/i);
    expect(runtime.state).toBe('failed');
    expect(runtime.host.state).toBe('failed');
    expect(runtime.host.diagnostics()).toMatchObject({ inputLeaseExpired: true, persistenceHealthy: false });
    expect(
      runtime.host.receiveInput({
        kind: 'input',
        protocolVersion: PROTOCOL_VERSION,
        epoch: runtime.epoch,
        stream: 'player-input',
        sequence: 0,
        targetPhysicsTick: runtime.host.snapshot.physicsTick + 1,
        issuedAtMs: now,
        state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
        edges: { jumpPressed: false },
      }),
    ).toBe('capacity');

    await expect(runtime.stop()).rejects.toThrow();
    const replacement = await create(dataDirectory, 'automatic-save-failure');
    await replacement.stop();
  });
});
