import { afterEach, expect, it, vi } from 'vitest';
import { startBrowserWorkerSession } from '../../../src/app/browser-worker-session';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { BrowserLogicClient, type LogicWorkerPort } from '../../../src/client/authority/browser-logic-client';
import { LOGIC_PROTOCOL_VERSION, type LogicWorkerResponse } from '@seedlands/stdlib/server/logic/logic-protocol';
import { FakeAuthorityWorker, ready } from '../client/fixtures/browser-authority';

vi.mock('../../../src/client/compute/browser-compute-runtime', () => ({
  BrowserComputeRuntime: class {
    dispose() {}
  },
}));
afterEach(() => vi.restoreAllMocks());

it('the actual worker-session entry forwards accepted pointer results to player feedback', async () => {
  const worker = new FakeAuthorityWorker();
  const originalPost = worker.postMessage.bind(worker);
  let epoch = '';
  worker.postMessage = (message, transfer) => {
    originalPost(message, transfer);
    if ((message as { kind: string }).kind === 'start-authority')
      queueMicrotask(() => {
        const fixture = ready();
        worker.emit({
          kind: 'authority-ready',
          protocolVersion: 1,
          epoch,
          ready: { ...fixture, snapshot: { ...fixture.snapshot, epoch } },
        });
      });
  };
  vi.spyOn(BrowserAuthorityClient, 'create').mockImplementation((sessionEpoch, options) => {
    epoch = sessionEpoch;
    return new BrowserAuthorityClient(worker, sessionEpoch, options);
  });
  vi.spyOn(BrowserLogicClient, 'create').mockImplementation((sessionEpoch, options) => {
    const ports: MessagePort[] = [];
    const logicWorker: LogicWorkerPort = {
      onmessage: null,
      onerror: null,
      postMessage(message, transfer = []) {
        ports.push(...transfer.filter((value): value is MessagePort => value instanceof MessagePort));
        if ((message as { kind: string }).kind === 'init-logic')
          queueMicrotask(() =>
            this.onmessage?.({
              data: { kind: 'logic-ready', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch: sessionEpoch },
            } as MessageEvent<LogicWorkerResponse>),
          );
      },
      terminate() {
        ports.forEach((port) => port.close());
      },
    };
    return new BrowserLogicClient(logicWorker, sessionEpoch, options);
  });
  const feedback = vi.fn();
  const session = await startBrowserWorkerSession({
    epochSequence: 1,
    seedText: 'session-pointer',
    openMode: 'continue',
    legacySnapshots: [],
    initialWorldTime: 9,
    harnessEnabled: false,
    generalWorkerCount: 1,
    wasm: { artifact: 'off', kernels: [] },
    frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    onSnapshot: vi.fn(),
    onGameplay: vi.fn(),
    onPlayerDeath: vi.fn(),
    onCommit: vi.fn(),
    onUnknownChunk: vi.fn(),
    onInputDecision: vi.fn(),
    onFatal: vi.fn(),
    ...{ onPointerAttackResult: feedback },
  });
  try {
    const receipt = {
      kind: 'pointer-attack-result' as const,
      protocolVersion: 1 as const,
      epoch,
      runtimeEpoch: epoch,
      sequence: 0,
      result: { result: { success: true, buffered: true }, gameplay: ready().gameplay, commits: [] },
    };
    worker.emit(receipt);
    worker.emit(receipt);
    expect(feedback).toHaveBeenCalledExactlyOnceWith({ success: true, buffered: true });
  } finally {
    session.logic.dispose();
    session.authority.dispose();
    session.compute.dispose();
  }
});
