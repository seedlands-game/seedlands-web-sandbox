import { describe, expect, it, vi } from 'vitest';
import { AuthorityWorkerDirectLogic } from '../../../src/worker/authority-worker-direct-logic';
import { AuthorityWorkerDirectLogicOwner } from '../../../src/worker/authority-worker-direct-logic-owner';
import {
  DIRECT_LOGIC_PROTOCOL_VERSION,
  type DirectLogicMessage,
} from '../../../src/worker/authority-worker-direct-logic-protocol';
import { createGameLogicWorkerHandler } from '../../../src/worker/game-logic-worker';
import {
  LOGIC_PROTOCOL_VERSION,
  type LogicIntentBatch,
  type LogicObservation,
  type LogicWorkerResponse,
} from '../../../../../packages/stdlib/src/server/logic/logic-protocol';

class FakePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posts: { message: unknown; transfer: readonly Transferable[] }[] = [];
  started = 0;
  closed = 0;
  throwOnPost = false;

  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (this.throwOnPost) throw new Error('port post failed');
    this.posts.push({ message, transfer });
  }

  start() {
    this.started += 1;
  }

  close() {
    this.closed += 1;
  }

  emit(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

const observation = (epoch: string, sequence: number): LogicObservation => ({
  protocolVersion: LOGIC_PROTOCOL_VERSION,
  epoch,
  observationSequence: sequence,
  physicsTick: sequence,
  activeTimeMs: sequence * 10,
  worldTime: 8,
  entities: [],
  decisionContext: {
    actors: [],
    pois: { version: 1, sequence: 0, pois: [] },
    terrainWindows: [
      {
        key: `0,0,${sequence}`,
        chunkRevision: 0,
        origin: [0, 0, 0],
        size: [1, 1, 1],
        occupancy: new Uint8Array([sequence]),
      },
    ],
  },
});

const batch = (epoch: string, sequence: number): LogicIntentBatch => ({
  protocolVersion: LOGIC_PROTOCOL_VERSION,
  epoch,
  observationSequence: sequence,
  expiresAtPhysicsTick: sequence + 12,
  intents: [],
});

const directBatch = (epoch: string, sequence: number): DirectLogicMessage => ({
  kind: 'direct-logic-intents',
  protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
  batch: batch(epoch, sequence),
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

class PromiseTailHarness {
  private tail: Promise<unknown> = Promise.resolve();
  readonly notifyProgress = vi.fn();

  acceptsAutomaticLogic = () => true;

  hostOperation<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  idle(): Promise<unknown> {
    return this.tail;
  }
}

const attachOwner = (state: () => unknown, epoch = 'epoch:1') => {
  const port = new FakePort();
  const fatal = vi.fn();
  const owner = new AuthorityWorkerDirectLogicOwner({
    state: () => state() as never,
    now: () => 0,
    diagnostics: vi.fn(),
    fatal,
  });
  owner.attach({
    kind: 'attach-direct-logic',
    protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
    epoch,
    port: port as unknown as MessagePort,
  });
  return { owner, port, fatal };
};

describe('AuthorityWorkerDirectLogic', () => {
  it('直接转移派生占用缓冲且仅保留最新待处理观察', async () => {
    const port = new FakePort();
    const accepted: LogicIntentBatch[] = [];
    const diagnostics: unknown[] = [];
    const link = new AuthorityWorkerDirectLogic(port as unknown as MessagePort, 'epoch:1', {
      acceptBatch: (value) => {
        accepted.push(value);
        return true;
      },
      now: () => 10,
      diagnostics: (value) => diagnostics.push(value),
      fatal: vi.fn(),
      diagnosticIntervalMs: 0,
    });
    const first = observation('epoch:1', 1);
    link.publish(first);
    link.publish(observation('epoch:1', 2));
    link.publish(observation('epoch:1', 3));

    expect(port.posts).toHaveLength(1);
    expect(port.posts[0]?.transfer).toEqual([first.decisionContext.terrainWindows[0]?.occupancy.buffer]);
    expect(diagnostics.at(-1)).toMatchObject({ observationInFlight: true, pendingObservationCount: 1 });

    port.emit(directBatch('epoch:other', 1));
    port.emit(directBatch('epoch:1', 2));
    await flush();
    expect(accepted).toEqual([]);
    expect(port.posts).toHaveLength(1);

    port.emit(directBatch('epoch:1', 1));
    await flush();
    expect(accepted.map((value) => value.observationSequence)).toEqual([1]);
    expect(
      port.posts.map(
        ({ message }) =>
          (message as Extract<DirectLogicMessage, { kind: 'direct-logic-observation' }>).observation
            ?.observationSequence,
      ),
    ).toEqual([1, 3]);
    expect(diagnostics.at(-1)).toMatchObject({ receivedBatchCount: 3, completedBatchCount: 1, rejectedBatchCount: 2 });
  });

  it('await期间拒绝重复回执且epoch切换不会让旧回执清除新代次任务', async () => {
    const port = new FakePort();
    let resolveOld!: (accepted: boolean) => void;
    const oldAcceptance = new Promise<boolean>((resolve) => (resolveOld = resolve));
    const accepted = vi.fn((value: LogicIntentBatch) =>
      value.epoch === 'epoch:old' ? oldAcceptance : Promise.resolve(true),
    );
    const link = new AuthorityWorkerDirectLogic(port as unknown as MessagePort, 'epoch:old', {
      acceptBatch: accepted,
      now: () => 20,
      diagnostics: vi.fn(),
      fatal: vi.fn(),
      diagnosticIntervalMs: 0,
    });
    link.publish(observation('epoch:old', 1));
    port.emit(directBatch('epoch:old', 1));
    port.emit(directBatch('epoch:old', 1));
    await flush();
    expect(accepted).toHaveBeenCalledTimes(1);

    link.rebindEpoch('epoch:new');
    link.publish(observation('epoch:new', 1));
    port.emit(directBatch('epoch:new', 1));
    await flush();
    resolveOld(true);
    await flush();

    expect(accepted).toHaveBeenCalledTimes(2);
    expect(port.posts.map(({ message }) => (message as { kind: string }).kind)).toEqual([
      'direct-logic-observation',
      'direct-logic-reset',
      'direct-logic-observation',
    ]);
  });

  it('发送或重绑失败会关闭端口并报告fatal', () => {
    const port = new FakePort();
    const fatal = vi.fn();
    const link = new AuthorityWorkerDirectLogic(port as unknown as MessagePort, 'epoch:1', {
      acceptBatch: () => true,
      now: () => 0,
      diagnostics: vi.fn(),
      fatal,
    });
    port.throwOnPost = true;
    link.publish(observation('epoch:1', 1));
    expect(port.closed).toBe(1);
    expect(fatal).toHaveBeenCalledWith(expect.objectContaining({ message: 'port post failed' }));

    const rebindPort = new FakePort();
    const rebindFatal = vi.fn();
    const rebindLink = new AuthorityWorkerDirectLogic(rebindPort as unknown as MessagePort, 'epoch:old', {
      acceptBatch: () => true,
      now: () => 0,
      diagnostics: vi.fn(),
      fatal: rebindFatal,
    });
    rebindPort.throwOnPost = true;
    rebindLink.rebindEpoch('epoch:new');
    expect(rebindPort.closed).toBe(1);
    expect(rebindFatal).toHaveBeenCalledWith(expect.objectContaining({ message: 'port post failed' }));
  });
});

describe('Game Logic Worker direct endpoint', () => {
  it('在端口内计算intent并按FIFO切换epoch，主线程不接收完整batch', () => {
    const mainPosts: LogicWorkerResponse[] = [];
    const port = new FakePort();
    const handle = createGameLogicWorkerHandler({ postMessage: (message) => mainPosts.push(message) });
    handle({
      kind: 'attach-direct-logic',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      epoch: 'epoch:old',
      port: port as unknown as MessagePort,
    });
    handle({
      kind: 'init-logic',
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: 'epoch:old',
      harnessEnabled: false,
      physicsHz: 60,
    });
    port.emit({
      kind: 'direct-logic-observation',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      observation: observation('epoch:old', 1),
    } satisfies DirectLogicMessage);
    port.emit({
      kind: 'direct-logic-reset',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      epoch: 'epoch:old',
      nextEpoch: 'epoch:new',
    } satisfies DirectLogicMessage);
    port.emit({
      kind: 'direct-logic-observation',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      observation: observation('epoch:old', 2),
    } satisfies DirectLogicMessage);
    port.emit({
      kind: 'direct-logic-observation',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      observation: observation('epoch:new', 1),
    } satisfies DirectLogicMessage);

    expect(mainPosts.map((message) => message.kind)).toEqual(['logic-ready']);
    expect(port.posts.map(({ message }) => (message as { batch: LogicIntentBatch }).batch.observationSequence)).toEqual(
      [1, 1],
    );
    expect(port.started).toBe(1);
  });
});

describe('AuthorityWorkerDirectLogicOwner', () => {
  it('推进已排队但尚未开始时提升旧回执，释放新推进观察且排队闭包不重复执行', async () => {
    const harness = new PromiseTailHarness();
    const ingressLogic = vi.fn();
    const acceptLogic = vi.fn(() => false);
    const runtime = { requestLogicObservation: vi.fn() };
    let advancing = false;
    const advance = {
      get isAdvancing() {
        return advancing;
      },
      acceptLogicIntentBatch: acceptLogic,
    };
    const state = { runtime, harness, ingress: { logic: ingressLogic }, advance };
    const { owner, port, fatal } = attachOwner(() => state);
    owner.publish(observation('epoch:1', 1), vi.fn());

    let postedDuringAdvance = false;
    let promotedByWrongEpoch = false;
    const queuedAdvance = harness.hostOperation(async () => {
      advancing = true;
      owner.publish(observation('epoch:other', 2), vi.fn());
      await flush();
      promotedByWrongEpoch = acceptLogic.mock.calls.length > 0;
      owner.publish(observation('epoch:1', 2), vi.fn());
      await flush();
      postedDuringAdvance = port.posts.length === 2;
      advancing = false;
    });
    port.emit(directBatch('epoch:1', 1));

    await queuedAdvance;
    await harness.idle();
    await flush();
    owner.close();

    expect(postedDuringAdvance).toBe(true);
    expect(promotedByWrongEpoch).toBe(false);
    expect(acceptLogic).toHaveBeenCalledTimes(1);
    expect(ingressLogic).toHaveBeenCalledTimes(1);
    expect(runtime.requestLogicObservation).not.toHaveBeenCalled();
    expect(fatal).not.toHaveBeenCalled();
  });

  it('关闭时使排队旧回执失效，后续队列释放也不执行副作用', async () => {
    const harness = new PromiseTailHarness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    void harness.hostOperation(() => blocked);
    const ingressLogic = vi.fn();
    const acceptLogic = vi.fn(() => true);
    const state = {
      runtime: { requestLogicObservation: vi.fn() },
      harness,
      ingress: { logic: ingressLogic },
      advance: { isAdvancing: false, acceptLogicIntentBatch: acceptLogic },
    };
    const { owner, port, fatal } = attachOwner(() => state);
    owner.publish(observation('epoch:1', 1), vi.fn());
    port.emit(directBatch('epoch:1', 1));
    owner.close();

    release();
    await harness.idle();
    await flush();

    expect(acceptLogic).not.toHaveBeenCalled();
    expect(ingressLogic).not.toHaveBeenCalled();
    expect(fatal).not.toHaveBeenCalled();
  });

  it.each([
    ['相同epoch', 'epoch:old', false],
    ['非法空epoch', '   ', true],
  ])('%s重绑不先取消排队回执', async (_label, nextEpoch, shouldThrow) => {
    const harness = new PromiseTailHarness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    void harness.hostOperation(() => blocked);
    const acceptLogic = vi.fn(() => true);
    const state = {
      runtime: { requestLogicObservation: vi.fn() },
      harness,
      ingress: { logic: vi.fn() },
      advance: { isAdvancing: false, acceptLogicIntentBatch: acceptLogic },
    };
    const { owner, port, fatal } = attachOwner(() => state, 'epoch:old');
    owner.publish(observation('epoch:old', 1), vi.fn());
    port.emit(directBatch('epoch:old', 1));

    if (shouldThrow) expect(() => owner.rebindEpoch(nextEpoch)).toThrow('Direct Logic epoch must not be empty.');
    else owner.rebindEpoch(nextEpoch);
    await flush();
    owner.publish(observation('epoch:old', 2), vi.fn());
    expect(port.posts).toHaveLength(1);

    release();
    await harness.idle();
    await flush();
    owner.close();
    expect(acceptLogic).toHaveBeenCalledTimes(1);
    expect(fatal).not.toHaveBeenCalled();
  });

  it('新epoch重绑取消旧排队回执，队列释放后只接受新epoch', async () => {
    const harness = new PromiseTailHarness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    void harness.hostOperation(() => blocked);
    const ingressLogic = vi.fn();
    const acceptLogic = vi.fn(() => true);
    const runtime = { requestLogicObservation: vi.fn() };
    const state = {
      runtime,
      harness,
      ingress: { logic: ingressLogic },
      advance: { isAdvancing: false, acceptLogicIntentBatch: acceptLogic },
    };
    const { owner, port, fatal } = attachOwner(() => state, 'epoch:old');
    owner.publish(observation('epoch:old', 1), vi.fn());
    port.emit(directBatch('epoch:old', 1));
    owner.rebindEpoch('epoch:new');
    owner.publish(observation('epoch:new', 1), vi.fn());
    port.emit(directBatch('epoch:new', 1));

    release();
    await harness.idle();
    await flush();
    owner.close();

    expect(acceptLogic).toHaveBeenCalledTimes(1);
    expect(acceptLogic).toHaveBeenCalledWith(expect.objectContaining({ epoch: 'epoch:new' }));
    expect(ingressLogic).toHaveBeenCalledTimes(1);
    expect(runtime.requestLogicObservation).toHaveBeenCalledTimes(1);
    expect(fatal).not.toHaveBeenCalled();
  });

  it('checkpoint类操作占用队列且未推进时不提升排队回执', async () => {
    const harness = new PromiseTailHarness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    void harness.hostOperation(() => blocked);
    const ingressLogic = vi.fn();
    const acceptLogic = vi.fn(() => true);
    const state = {
      runtime: { requestLogicObservation: vi.fn() },
      harness,
      ingress: { logic: ingressLogic },
      advance: { isAdvancing: false, acceptLogicIntentBatch: acceptLogic },
    };
    const { owner, port } = attachOwner(() => state);
    owner.publish(observation('epoch:1', 1), vi.fn());
    port.emit(directBatch('epoch:1', 1));
    owner.publish(observation('epoch:1', 2), vi.fn());
    await flush();

    expect(port.posts).toHaveLength(1);
    expect(acceptLogic).not.toHaveBeenCalled();

    release();
    await harness.idle();
    await flush();
    owner.close();

    expect(port.posts).toHaveLength(2);
    expect(acceptLogic).toHaveBeenCalledTimes(1);
    expect(ingressLogic).toHaveBeenCalledTimes(1);
  });

  it('回执异常只关闭一次Direct Logic且不阻塞后续Harness队列', async () => {
    const harness = new PromiseTailHarness();
    const ingressLogic = vi.fn();
    const acceptLogic = vi.fn(() => {
      throw new Error('accept failed');
    });
    const state = {
      runtime: { requestLogicObservation: vi.fn() },
      harness,
      ingress: { logic: ingressLogic },
      advance: { isAdvancing: false, acceptLogicIntentBatch: acceptLogic },
    };
    const { owner, port, fatal } = attachOwner(() => state);
    const continued = vi.fn();
    owner.publish(observation('epoch:1', 1), vi.fn());
    port.emit(directBatch('epoch:1', 1));
    void harness.hostOperation(continued);

    await harness.idle();
    await flush();
    owner.close();

    expect(acceptLogic).toHaveBeenCalledTimes(1);
    expect(ingressLogic).toHaveBeenCalledTimes(1);
    expect(harness.notifyProgress).not.toHaveBeenCalled();
    expect(continued).toHaveBeenCalledTimes(1);
    expect(port.closed).toBe(1);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal).toHaveBeenCalledWith(expect.objectContaining({ message: 'accept failed' }));
  });

  it('排队等待期间Authority owner被替换时拒绝旧batch且不触碰新世界', async () => {
    let runQueued!: () => void;
    const ingressLogic = vi.fn();
    const acceptLogic = vi.fn(() => true);
    const oldRuntime = { requestLogicObservation: vi.fn() };
    const oldHarness = {
      acceptsAutomaticLogic: () => true,
      notifyProgress: vi.fn(),
      hostOperation: (operation: () => boolean) =>
        new Promise<boolean>((resolve) => {
          runQueued = () => resolve(operation());
        }),
    };
    const oldIngress = { logic: ingressLogic };
    const oldAdvance = { isAdvancing: false, acceptLogicIntentBatch: acceptLogic };
    let state = {
      runtime: oldRuntime,
      harness: oldHarness,
      ingress: oldIngress,
      advance: oldAdvance,
    };
    const { owner, port } = attachOwner(() => state, 'epoch:old');
    owner.publish(observation('epoch:old', 1), vi.fn());
    port.emit(directBatch('epoch:old', 1));
    await flush();

    state = { ...state, runtime: { requestLogicObservation: vi.fn() } };
    runQueued();
    await flush();

    expect(ingressLogic).not.toHaveBeenCalled();
    expect(acceptLogic).not.toHaveBeenCalled();
    expect(oldRuntime.requestLogicObservation).not.toHaveBeenCalled();
  });
});
