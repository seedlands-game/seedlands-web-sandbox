import { describe, expect, it, vi } from 'vitest';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeTask,
} from '../../src/server/compute/dedicated-compute-contract';
import { runDedicatedComputeTask } from '../../src/server/compute/run-dedicated-compute-task';
import { DedicatedServerHost } from '../../src/server/dedicated/dedicated-server-host';
import { dedicatedLimits } from '../../src/server/dedicated/dedicated-host-types';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { PROTOCOL_VERSION } from '../../src/runtime/session-protocol';
import { CHUNK_SIZE } from '../../src/world/voxel';

const executor = () => ({
  execute: vi.fn(async (task: DedicatedComputeTask) => {
    if (task.kind === 'generate-canonical')
      return {
        kind: 'canonical-result' as const,
        key: task.key,
        cx: task.cx,
        cy: task.cy,
        cz: task.cz,
        generatorVersion: task.generatorVersion,
        chunkRevision: 0 as const,
        voxels: new Uint16Array(CHUNK_SIZE ** 3).buffer,
      };
    return runDedicatedComputeTask(task);
  }),
  close: vi.fn(async () => {}),
  diagnostics: () => ({
    mode: 'inline' as const,
    generation: 0,
    queued: 0,
    queuedBytes: 0,
    running: 0,
    runningBytes: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    staleResults: 0,
    childPids: [],
    workerThreadIds: [],
    poolSize: 1,
    liveSlots: 0,
    terminatingSlots: 0,
    health: 'healthy' as const,
    restartCountLastMinute: 0,
    ipcBacklogBytes: 0,
    slotCompletedTasks: [0],
    taskIdHighWatermark: -1,
  }),
});

const create = async (compute: DedicatedComputeExecutor = executor(), persistence = new MemoryGamePersistence()) => {
  let time = 0;
  const host = await DedicatedServerHost.create({
    epoch: 'dedicated-test',
    seedText: 'dedicated-test',
    initialPlayerBodyPosition: [0.5, 33, 0.5],
    persistence,
    executors: { general: compute, fluid: compute, logic: compute },
    now: () => time,
  });
  return { host, persistence, tick: (next: number) => host.wake((time = next)) };
};

describe('DedicatedServerHost', () => {
  it('启动前拒绝没有输入预算空间的结果预留配置', () => {
    expect(() => dedicatedLimits({ mailboxBytes: 1024, computeResultBytes: 2048 })).toThrow(RangeError);
    expect(() => dedicatedLimits({ mailboxBytes: 1024, computeResultBytes: 1024 })).toThrow(RangeError);
    expect(dedicatedLimits({ mailboxBytes: 1024, computeResultBytes: 512 }).computeResultBytes).toBe(512);
  });

  it('无需客户端唤醒各权威周期并提交服务端 Logic 候选', async () => {
    const compute = executor();
    const { host, tick } = await create(compute);
    const before = host.snapshot;
    tick(100);
    await host.waitForIdle();
    expect(host.snapshot.physicsTick).toBeGreaterThan(before.physicsTick);
    expect(host.runtime.server.worldTime).toBeGreaterThan(9);
    expect(compute.execute.mock.calls.some(([task]) => task.kind === 'logic')).toBe(true);
    expect(host.state).toBe('running');
    await host.stop();
    expect(compute.close).toHaveBeenCalledTimes(1);
  });

  it('canonical 候选先进入 mailbox，相同 Chunk 请求合并', async () => {
    const compute = executor();
    const { host } = await create(compute);
    const first = host.requestChunk('2,2,2');
    const second = host.requestChunk('2,2,2');
    expect(first).toBe(second);
    await Promise.resolve();
    expect(host.runtime.readCollisionBaseline('2,2,2', 0).status).toBe('unavailable');
    await host.waitForIdle();
    expect(await first).toBe(true);
    expect(host.runtime.readCollisionBaseline('2,2,2', 0).status).toBe('available');
    expect(
      compute.execute.mock.calls.filter(([task]) => task.kind === 'generate-canonical' && task.key === '2,2,2'),
    ).toHaveLength(1);
    await host.stop();
  });

  it('宿主调度遵守单槽上限，候选提交前保留预算，关停排空其余排队工作', async () => {
    const compute = executor();
    const { host } = await create(compute);
    await host.waitForIdle();
    compute.execute.mockClear();
    const execute = compute.execute.getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    compute.execute.mockImplementationOnce(async (task) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        entered();
      });
      return execute(task);
    });
    const completions = ['20,2,20', '21,2,20', '22,2,20'].map((key) => host.requestChunk(key));
    await started;
    release();
    await vi.waitFor(() => expect(host.diagnostics().mailboxCount).toBeGreaterThan(0));
    expect(compute.execute).toHaveBeenCalledTimes(1);
    expect(host.diagnostics()).toMatchObject({
      computeScheduler: {
        queued: 2,
        pendingJobs: 3,
        heldResultBytes: expect.any(Number),
        reservedResultBytes: expect.any(Number),
      },
    });
    // stop 必须边提交 mailbox 边推进队列，不能先等全部候选 Promise 而死锁。
    await host.stop();
    expect(await Promise.all(completions)).toEqual([true, true, true]);
    expect(host.diagnostics()).toMatchObject({
      computeScheduler: { pendingJobs: 0, reservedBytes: 0 },
    });
    expect(compute.close).toHaveBeenCalledTimes(1);
  });

  it('远端 Chunk 请求先恢复已有存档，不用基础生成覆盖编辑', async () => {
    const compute = executor();
    const persistence = new MemoryGamePersistence();
    const { host } = await create(compute, persistence);
    const voxels = new Uint16Array(CHUNK_SIZE ** 3);
    voxels[0] = 1;
    persistence.saveSnapshots([
      {
        key: '12,2,12',
        cx: 12,
        cy: 2,
        cz: 12,
        seedText: 'dedicated-test',
        generatorVersion: host.runtime.server.generatorVersion,
        revision: 7,
        voxels,
      },
    ]);
    const ready = host.requestChunk('12,2,12');
    await host.waitForIdle();
    expect(await ready).toBe(true);
    expect(host.runtime.readCollisionBaseline('12,2,12', 7).status).toBe('available');
    expect(
      compute.execute.mock.calls.filter(([task]) => task.kind === 'generate-canonical' && task.key === '12,2,12'),
    ).toHaveLength(0);
    await host.stop();
  });

  it('500ms 输入租期过期清空移动/跳跃但世界继续运行，重复输入不能续租', async () => {
    const { host, tick } = await create();
    const input = {
      kind: 'input' as const,
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'dedicated-test',
      stream: 'player-input',
      sequence: 0,
      targetPhysicsTick: 1,
      issuedAtMs: 0,
      state: { moveX: 1, moveZ: 0, verticalIntent: 1 as const, jumpHeld: true },
      edges: { jumpPressed: true },
    };
    expect(host.receiveInput(input)).toBe('accepted');
    tick(100);
    expect(host.receiveInput(input)).toBe('duplicate');
    tick(501);
    expect(host.diagnostics().inputLeaseExpired).toBe(true);
    expect(host.snapshot.paused).toBe(false);
    expect(host.snapshot.player.body.velocity.x).toBe(0);
    await host.stop();
  });

  it('保存异步时继续 tick，失败后明确降级且拒绝新玩家写入', async () => {
    const { host, persistence, tick } = await create();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = persistence.saveFrozenSnapshot.bind(persistence);
    vi.spyOn(persistence, 'saveFrozenSnapshot').mockImplementationOnce(async (snapshot) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        entered();
      });
      original(snapshot);
    });
    const save = host.save();
    await started;
    const before = host.snapshot.physicsTick;
    tick(100);
    expect(host.snapshot.physicsTick).toBeGreaterThan(before);
    release();
    await save;
    persistence.failNextFrozenSave(new Error('disk full'));
    await expect(host.save()).rejects.toThrow('disk full');
    expect(host.diagnostics().persistenceHealthy).toBe(false);
    await expect(host.performAction({ type: 'cancel-break' }, 0)).rejects.toThrow();
    await host.stop();
  });

  it('关停发布最终冻结检查点，关停后不再推进或接纳 Chunk', async () => {
    const { host, persistence, tick } = await create();
    tick(100);
    await host.stop();
    expect(persistence.loadGameCheckpoint()?.commitSequence).toBe(host.snapshot.commitSequence);
    const snapshot = host.snapshot;
    tick(200);
    expect(host.snapshot).toEqual(snapshot);
    expect(await host.requestChunk('3,3,3')).toBe(false);
    expect(host.state).toBe('stopped');
  });
});
