import { describe, expect, it, vi } from 'vitest';
import { createGameLogicWorkerHandler } from '../../../src/worker/game-logic-worker';
import type { LogicObservation } from '../../../../../packages/stdlib/src/server/logic/logic-protocol';

const emptyObservation = (epoch: string): LogicObservation => ({
  protocolVersion: 1,
  epoch,
  observationSequence: 1,
  physicsTick: 10,
  activeTimeMs: 100,
  worldTime: 12,
  entities: [],
  decisionContext: {
    actors: [],
    pois: { version: 1, sequence: 0, pois: [] },
    terrainWindows: [],
  },
});

describe('Game Logic Worker 消息边界', () => {
  it('初始化后只接收当前 epoch 的观察并发回意图包', () => {
    const posts: unknown[] = [];
    const handle = createGameLogicWorkerHandler({ postMessage: (message) => posts.push(message) });

    handle({ kind: 'init-logic', protocolVersion: 1, epoch: 'session-a', harnessEnabled: false, physicsHz: 60 });
    handle({ kind: 'logic-observation', protocolVersion: 1, observation: emptyObservation('old') });
    handle({ kind: 'logic-observation', protocolVersion: 1, observation: emptyObservation('session-a') });

    expect(posts).toEqual([
      { kind: 'logic-ready', protocolVersion: 1, epoch: 'session-a' },
      {
        kind: 'logic-intents',
        protocolVersion: 1,
        batch: expect.objectContaining({ epoch: 'session-a', observationSequence: 1, intents: [] }),
      },
    ]);
  });

  it('普通产品会拒绝测试阻塞，只有明确 harness 会实际阻塞 Logic', () => {
    const productPosts: unknown[] = [];
    const product = createGameLogicWorkerHandler({ postMessage: (message) => productPosts.push(message) });
    product({ kind: 'init-logic', protocolVersion: 1, epoch: 'product', harnessEnabled: false, physicsHz: 60 });
    product({ kind: 'block-for-test', protocolVersion: 1, epoch: 'product', requestId: 1, ms: 500 });
    expect(productPosts.at(-1)).toMatchObject({
      kind: 'logic-fatal',
      epoch: 'product',
      error: expect.stringMatching(/harness/i),
    });

    let now = 0;
    const nowMs = vi.fn(() => (now += 10));
    const harnessPosts: unknown[] = [];
    const harness = createGameLogicWorkerHandler({
      postMessage: (message) => harnessPosts.push(message),
      nowMs,
    });
    harness({ kind: 'init-logic', protocolVersion: 1, epoch: 'harness', harnessEnabled: true, physicsHz: 120 });
    harness({ kind: 'block-for-test', protocolVersion: 1, epoch: 'harness', requestId: 2, ms: 50 });
    expect(nowMs).toHaveBeenCalledTimes(6);
    expect(harnessPosts).toEqual([
      { kind: 'logic-ready', protocolVersion: 1, epoch: 'harness' },
      { kind: 'logic-block-started', protocolVersion: 1, epoch: 'harness', requestId: 2 },
      { kind: 'logic-block-finished', protocolVersion: 1, epoch: 'harness', requestId: 2 },
    ]);
  });

  it('dispose 后忽略消息，初始化顺序和协议错误会返回明确 fatal', () => {
    const posts: unknown[] = [];
    const handle = createGameLogicWorkerHandler({ postMessage: (message) => posts.push(message) });
    handle({ kind: 'logic-observation', protocolVersion: 1, observation: emptyObservation('missing') });
    expect(posts.at(-1)).toMatchObject({ kind: 'logic-fatal', epoch: 'missing' });
    handle({ kind: 'init-logic', protocolVersion: 1, epoch: 'a', harnessEnabled: false, physicsHz: 30 });
    handle({ kind: 'dispose-logic', protocolVersion: 1, epoch: 'a' });
    handle({ kind: 'logic-observation', protocolVersion: 1, observation: emptyObservation('a') });
    expect(posts.filter((message) => (message as { kind?: string }).kind === 'logic-intents')).toHaveLength(0);
  });
});
