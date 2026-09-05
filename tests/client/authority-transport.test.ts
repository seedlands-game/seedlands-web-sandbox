import { describe, expect, it, vi } from 'vitest';
import { createAuthorityTransport, type AuthorityTransportPort } from '../../src/client/authority-transport';

class RawPort implements AuthorityTransportPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  terminated = false;
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

class ThrowingPort extends RawPort {
  override postMessage() {
    throw new DOMException('clone failed', 'DataCloneError');
  }
}

describe('Authority 受控传输', () => {
  it.each([0, 50, 150] as const)('只在 Harness 中按 %ims 延迟双向消息', (latencyMs) => {
    vi.useFakeTimers();
    const raw = new RawPort();
    const transport = createAuthorityTransport(raw, { harnessEnabled: true, latencyMs });
    const received = vi.fn();
    transport.onmessage = received;

    transport.postMessage({ kind: 'input', sequence: 1 });
    raw.emit({ kind: 'snapshot', physicsTick: 1 });
    expect(raw.posts).toHaveLength(latencyMs ? 0 : 1);
    expect(received).toHaveBeenCalledTimes(latencyMs ? 0 : 1);

    vi.advanceTimersByTime(latencyMs);
    expect(raw.posts).toEqual([{ kind: 'input', sequence: 1 }]);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ data: { kind: 'snapshot', physicsTick: 1 } }));
    vi.useRealTimers();
  });

  it('重复投递保留原事务键，乱序只改变到达顺序', () => {
    vi.useFakeTimers();
    const raw = new RawPort();
    const transport = createAuthorityTransport(raw, {
      harnessEnabled: true,
      latencyMs: 50,
      duplicateOutbound: true,
      reorderInbound: true,
    });
    const received: number[] = [];
    transport.onmessage = (event) => received.push((event.data as { physicsTick: number }).physicsTick);
    const transaction = { epoch: 'world:1', issuer: 'browser', stream: 'edit', sequence: 7 };

    transport.postMessage({ kind: 'start-authority' });
    transport.postMessage({ kind: 'world-edit', transaction });
    raw.emit({ kind: 'snapshot', physicsTick: 1 });
    raw.emit({ kind: 'snapshot', physicsTick: 2 });
    vi.advanceTimersByTime(50);
    expect(received).toEqual([2]);
    vi.runAllTimers();

    expect(raw.posts).toEqual([
      { kind: 'start-authority' },
      { kind: 'world-edit', transaction },
      { kind: 'world-edit', transaction },
    ]);
    expect(received).toEqual([2, 1]);
    expect((raw.posts[2] as { transaction: unknown }).transaction).toEqual(transaction);
    vi.useRealTimers();
  });

  it('拒绝在普通产品路径启用故障，并在销毁时取消全部在途投递', () => {
    expect(() => createAuthorityTransport(new RawPort(), { harnessEnabled: false, latencyMs: 50 })).toThrow(/Harness/);

    vi.useFakeTimers();
    const raw = new RawPort();
    const transport = createAuthorityTransport(raw, { harnessEnabled: true, latencyMs: 150 });
    const received = vi.fn();
    transport.onmessage = received;
    transport.postMessage({ kind: 'input' });
    raw.emit({ kind: 'snapshot' });
    transport.terminate();
    vi.runAllTimers();

    expect(raw.posts).toEqual([]);
    expect(received).not.toHaveBeenCalled();
    expect(raw.terminated).toBe(true);
    vi.useRealTimers();
  });

  it('把延迟投递异常转成端口错误而非遗留未捕获计时器', () => {
    vi.useFakeTimers();
    const transport = createAuthorityTransport(new ThrowingPort(), { harnessEnabled: true, latencyMs: 50 });
    const failed = vi.fn();
    transport.onerror = failed;

    transport.postMessage({ kind: 'input', sequence: 1 });
    vi.runAllTimers();

    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'clone failed' }));
    vi.useRealTimers();
  });
});
