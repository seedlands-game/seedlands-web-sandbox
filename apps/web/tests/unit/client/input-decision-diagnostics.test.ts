import { expect, it, vi } from 'vitest';
import { FakeAuthorityWorker } from './fixtures/browser-authority';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { readInputDecisionDiagnostics } from '../../../src/client/authority/input-decision-diagnostics';
import type { InputCommand } from '@seedlands/stdlib/runtime/session-protocol';

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

const command = (sequence: number): InputCommand => ({
  kind: 'input',
  protocolVersion: 1,
  epoch: 'runtime:1',
  stream: 'player-input',
  sequence,
  targetPhysicsTick: 10 + sequence,
  issuedAtMs: 20 + sequence,
  movementRevision: 'movement:3',
  state: { moveX: 0, moveZ: 1, verticalIntent: 0, jumpHeld: false },
  edges: { jumpPressed: false },
});

it('关联实际发送命令、Authority接收tick及拒绝后的首条accepted回执', () => {
  const worker = new FakeAuthorityWorker();
  const callback = vi.fn();
  const client = new BrowserAuthorityClient(worker, 'world:1', { onInputDecision: callback });
  const input = command(4);
  client.sendInput(input);
  Reflect.set(input.state, 'moveZ', -1);
  worker.emit({ ...receipt, observation: { authorityPhysicsTick: 15, receivedAtTimeOriginMs: 1000 } });
  client.sendInput(command(5));
  worker.emit({
    ...receipt,
    sequence: 5,
    decision: 'accepted',
    requiresResync: false,
    observation: { authorityPhysicsTick: 15, receivedAtTimeOriginMs: 1010 },
  });
  const result = readInputDecisionDiagnostics(client)!;
  expect(result.recentReceipts[0]!).toMatchObject({
    sequence: 4,
    decision: 'late',
    command: { targetPhysicsTick: 14, issuedAtMs: 24, movementRevision: 'movement:3', state: { moveZ: 1 } },
    authority: { authorityPhysicsTick: 15, receivedAtTimeOriginMs: 1000 },
  });
  expect(Number.isFinite(result.recentReceipts[0]!.command!.postedAtTimeOriginMs)).toBe(true);
  expect(result.rejectedReceipts[0]!.recovery).toMatchObject({ sequence: 5, decision: 'accepted' });
  expect(callback).toHaveBeenCalledWith({ sequence: 4, decision: 'late', requiresResync: true });
  expect(Reflect.set(result.recentReceipts[0]!.command!.state, 'moveZ', -1)).toBe(false);
  expect(Reflect.set(result.rejectedReceipts[0]!, 'recovery', null)).toBe(false);
});

it('保留旧receipt兼容性，忽略旧epoch/重复与非法诊断字段', () => {
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'world:1');
  client.sendInput(command(4));
  worker.emit({ ...receipt, epoch: 'old', observation: { authorityPhysicsTick: 100, receivedAtTimeOriginMs: 1000 } });
  worker.emit({ ...receipt, observation: { authorityPhysicsTick: -1, receivedAtTimeOriginMs: NaN } });
  worker.emit(receipt);
  const result = readInputDecisionDiagnostics(client)!;
  expect(result.totalReceipts).toBe(1);
  expect(result.recentReceipts).toHaveLength(1);
  expect(result.recentReceipts[0]!.command!.sequence).toBe(4);
  expect(result.recentReceipts[0]!.authority).toBeNull();
});

it('有界截断回执和拒绝尾部，后续accepted同时关联保留的全部拒绝', () => {
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'world:1');
  for (let sequence = 0; sequence < 300; sequence++) {
    client.sendInput(command(sequence));
    worker.emit({ ...receipt, sequence });
  }
  client.sendInput(command(300));
  worker.emit({ ...receipt, sequence: 300, decision: 'accepted', requiresResync: false });
  const result = readInputDecisionDiagnostics(client)!;
  expect(result.totalReceipts).toBe(301);
  expect(result.recentReceipts).toHaveLength(256);
  expect(result.recentReceipts[0]!.sequence).toBe(45);
  expect(result.rejectedReceipts).toHaveLength(128);
  expect(result.rejectedReceipts[0]!.receipt.sequence).toBe(172);
  expect(result.rejectedReceipts.every((entry) => entry.recovery!.sequence === 300)).toBe(true);
});

it('未回执命令有界且post失败不留下已发送假证据', () => {
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'world:1');
  for (let sequence = 0; sequence < 300; sequence++) client.sendInput(command(sequence));
  worker.emit({ ...receipt, sequence: 0 });
  worker.emit({ ...receipt, sequence: 299 });
  worker.postMessage = () => {
    throw new Error('post-failed');
  };
  expect(() => client.sendInput(command(300))).toThrow('post-failed');
  worker.emit({ ...receipt, sequence: 300 });
  const result = readInputDecisionDiagnostics(client)!;
  expect(result.recentReceipts.map((entry) => entry.command?.sequence ?? null)).toEqual([null, 299, null]);
});

it('同步post回执与callback重入不丢失命令关联或污染拒绝记录', () => {
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'world:1', {
    onInputDecision: (decision) => {
      worker.emit(receipt);
      Reflect.set(decision, 'decision', 'accepted');
    },
  });
  worker.postMessage = () => worker.emit(receipt);
  client.sendInput(command(4));
  const result = readInputDecisionDiagnostics(client)!;
  expect(result.totalReceipts).toBe(1);
  expect(result.rejectedReceipts[0]!.receipt.command?.sequence).toBe(4);
  expect(result.rejectedReceipts[0]!.receipt.decision).toBe('late');
  expect(result.rejectedReceipts[0]!.recovery).toBeNull();
});
