import { expect, it, vi } from 'vitest';
import { FakeAuthorityWorker } from './fixtures/browser-authority';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { readInputDecisionDiagnostics } from '../../../src/client/authority/input-decision-diagnostics';

const receipt = {
  kind: 'input-decision' as const,
  protocolVersion: 1 as const,
  epoch: 'world:1',
  sequence: 4,
  decision: 'late' as const,
  requiresResync: true,
};

it('只读计数保留回调重入时已经更新的sequence门禁', () => {
  const worker = new FakeAuthorityWorker();
  const callback = vi.fn(() => worker.emit(receipt));
  const client = new BrowserAuthorityClient(worker, 'world:1', { onInputDecision: callback });
  worker.emit(receipt);
  expect(callback).toHaveBeenCalledOnce();
  expect(readInputDecisionDiagnostics(client)).toMatchObject({ totalReceipts: 1, byDecision: { late: 1 } });
});

it('其他epoch与读出副本不改变当前client诊断', () => {
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'world:1');
  worker.emit({ ...receipt, epoch: 'wrong-epoch' });
  expect(readInputDecisionDiagnostics(client)?.totalReceipts).toBe(0);
  worker.emit(receipt);
  const readback = readInputDecisionDiagnostics(client)!;
  expect(Reflect.set(readback.byDecision, 'late', 100)).toBe(false);
  expect(readInputDecisionDiagnostics(client)?.byDecision).toEqual({ late: 1 });
});

it('callback自行修改其副本不能污染已记录的owner receipt', () => {
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'world:1', {
    onInputDecision: (decision) => {
      decision.decision = 'capacity';
    },
  });
  worker.emit(receipt);
  expect(readInputDecisionDiagnostics(client)?.byDecision).toEqual({ late: 1 });
});
