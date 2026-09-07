import { describe, expect, it } from 'vitest';
import {
  projectInterestControlReference,
  validateInterestControlReference,
  type InterestControlTrustedContext,
} from '../../packages/game-core/src/server/protocol/network-reference-interest-control';

const context: InterestControlTrustedContext = {
  ref: { epoch: 'client:1', serverEpoch: 'server:9', sessionId: 'session:4', worldId: 'world:seed' },
};

const ref = () => ({ ...context.ref });
const request = (overrides: Record<string, unknown> = {}) => ({
  kind: 'interest-request-reference',
  projectionVersion: 1,
  wireStatus: 'not-adopted',
  ref: ref(),
  requestId: 4,
  demand: [{ key: '0,1,-1', minimumRevision: 2 }],
  ...overrides,
});
const accepted = (overrides: Record<string, unknown> = {}) => ({
  kind: 'interest-accepted-reference',
  projectionVersion: 1,
  wireStatus: 'not-adopted',
  ref: ref(),
  requestId: 4,
  interestId: 8,
  granted: [{ key: '0,1,-1', minimumRevision: 2 }],
  rejected: [],
  ...overrides,
});
const cancel = (overrides: Record<string, unknown> = {}) => ({
  kind: 'interest-cancel-reference',
  projectionVersion: 1,
  wireStatus: 'not-adopted',
  ref: ref(),
  requestId: 5,
  targetRequestId: 4,
  interestId: 8,
  keys: ['0,1,-1'],
  ...overrides,
});
const cancelled = (overrides: Record<string, unknown> = {}) => ({
  kind: 'interest-cancelled-reference',
  projectionVersion: 1,
  wireStatus: 'not-adopted',
  ref: ref(),
  requestId: 5,
  targetRequestId: 4,
  interestId: 8,
  scope: 'granted-keys',
  keys: ['0,1,-1'],
  status: 'cancelled',
  ...overrides,
});
const collision = (overrides: Record<string, unknown> = {}) => ({
  kind: 'collision-baseline-request-reference',
  projectionVersion: 1,
  wireStatus: 'not-adopted',
  ref: ref(),
  requestId: 6,
  interestId: null,
  purpose: 'collision-resync',
  key: '0,1,-1',
  minimumRevision: 2,
  ...overrides,
});

describe('projectInterestControlReference', () => {
  it('投影五种 v1 控制对象为独立副本，并把整数 -0 规范为 +0', () => {
    const source = request({ requestId: -0, demand: [{ key: '0,1,-1', minimumRevision: -0 }] });
    const projected = projectInterestControlReference(source, context);
    const variants = [accepted(), cancel(), cancelled(), collision()];
    expect(projected.kind).toBe('interest-request-reference');
    expect(Object.is(projected.requestId, 0)).toBe(true);
    if (projected.kind !== 'interest-request-reference') throw new Error('Expected interest request.');
    expect(Object.is(projected.demand[0]!.minimumRevision, 0)).toBe(true);
    expect(variants.map((value) => projectInterestControlReference(value, context).kind)).toEqual([
      'interest-accepted-reference',
      'interest-cancel-reference',
      'interest-cancelled-reference',
      'collision-baseline-request-reference',
    ]);
    (source.demand as { key: string; minimumRevision: number }[])[0]!.key = '9,9,9';
    expect(projected.demand[0]!.key).toBe('0,1,-1');
  });

  it('validate 只判断可投影，不能规范化或让消费者继续持有原对象', () => {
    const source = request({ requestId: -0 });
    expect(validateInterestControlReference(source, context)).toBe(true);
    expect(Object.is(source.requestId, -0)).toBe(true);
    const projected = projectInterestControlReference(source, context);
    expect(Object.is(projected.requestId, 0)).toBe(true);
  });

  it('拒绝错误可信会话、未知字段和不受限身份扩展', () => {
    expect(() => projectInterestControlReference(request({ ref: { ...ref(), worldId: 'other' } }), context)).toThrow(
      /ref/i,
    );
    expect(() => projectInterestControlReference(request({ playerId: 'forged' }), context)).toThrow(/unknown/i);
    expect(() =>
      projectInterestControlReference(
        request({ demand: [{ key: '0,1,-1', minimumRevision: 2, radius: 99 }] }),
        context,
      ),
    ).toThrow(/unknown/i);
  });

  it.each(['epoch', 'serverEpoch', 'sessionId', 'worldId'] as const)('拒绝与可信 context 不同的 %s', (field) => {
    expect(() => projectInterestControlReference(request({ ref: { ...ref(), [field]: 'other' } }), context)).toThrow(
      /ref/i,
    );
  });

  it('拒绝五种 variant 的错误 kind、版本和 wire 状态', () => {
    const variants = [request(), accepted(), cancel(), cancelled(), collision()];
    for (const source of variants) {
      expect(() => projectInterestControlReference({ ...source, kind: 'invalid' }, context)).toThrow(/kind/i);
      expect(() => projectInterestControlReference({ ...source, projectionVersion: 2 }, context)).toThrow(
        /projectionVersion/i,
      );
      expect(() => projectInterestControlReference({ ...source, wireStatus: 'adopted' }, context)).toThrow(
        /wireStatus/i,
      );
    }
  });

  it('拒绝不安全 demand、稀疏或重复 key 以及超过 256 项', () => {
    expect(() => projectInterestControlReference(request({ requestId: -1 }), context)).toThrow(/integer/i);
    expect(() => projectInterestControlReference(request({ requestId: Number.MAX_SAFE_INTEGER + 1 }), context)).toThrow(
      /integer/i,
    );
    expect(() =>
      projectInterestControlReference(request({ demand: [{ key: '01,1,-1', minimumRevision: 2 }] }), context),
    ).toThrow(/canonical/i);
    expect(() =>
      projectInterestControlReference(
        request({
          demand: [
            { key: '0,1,-1', minimumRevision: 2 },
            { key: '0,1,-1', minimumRevision: 3 },
          ],
        }),
        context,
      ),
    ).toThrow(/duplicate/i);
    const sparse = [{ key: '0,1,-1', minimumRevision: 2 }];
    sparse.length = 2;
    expect(() => projectInterestControlReference(request({ demand: sparse }), context)).toThrow(/dense/i);
    expect(() =>
      projectInterestControlReference(
        request({ demand: Array.from({ length: 257 }, (_, x) => ({ key: `${x},1,-1`, minimumRevision: 0 })) }),
        context,
      ),
    ).toThrow(/256/i);
  });

  it('在扫描内容前拒绝超出预算的 demand、keys 与 rejected 数组', () => {
    const hugeArray = () => {
      const source: unknown[] = [];
      source.length = 1_000_000_000;
      return new Proxy(source, {
        has: (_target, property) => {
          if (typeof property === 'string' && /^\d+$/.test(property)) throw new Error('sentinel accessed item');
          return false;
        },
      });
    };
    expect(() => projectInterestControlReference(request({ demand: hugeArray() }), context)).toThrow(/256/i);
    expect(() => projectInterestControlReference(cancel({ keys: hugeArray() }), context)).toThrow(/256/i);
    expect(() => projectInterestControlReference(accepted({ granted: [], rejected: hugeArray() }), context)).toThrow(
      /256/i,
    );
  });

  it('拒绝顶层、嵌套对象与数组的 Symbol 扩展字段，且投影不保留它们', () => {
    const symbol = Symbol('unknown');
    const topLevel = request();
    Object.defineProperty(topLevel, symbol, { value: true, enumerable: true });
    expect(() => projectInterestControlReference(topLevel, context)).toThrow(/unknown/i);
    const nested = request();
    Object.defineProperty(nested.ref, symbol, { value: true, enumerable: true });
    expect(() => projectInterestControlReference(nested, context)).toThrow(/unknown/i);
    const demand = [{ key: '0,1,-1', minimumRevision: 2 }];
    Object.defineProperty(demand, symbol, { value: true, enumerable: true });
    expect(() => projectInterestControlReference(request({ demand }), context)).toThrow(/extension/i);
    expect(Object.getOwnPropertySymbols(projectInterestControlReference(request(), context))).toEqual([]);
  });

  it('严格区分取消自身 requestId、targetRequestId、null interest 和终态 scope', () => {
    expect(() => projectInterestControlReference(cancel({ requestId: 4 }), context)).toThrow(/different/i);
    expect(() => projectInterestControlReference(cancel({ interestId: null, keys: ['0,1,-1'] }), context)).toThrow(
      /null.*keys/i,
    );
    expect(() =>
      projectInterestControlReference(cancelled({ interestId: null, scope: 'granted-keys' }), context),
    ).toThrow(/scope/i);
    expect(() =>
      projectInterestControlReference(cancelled({ scope: 'whole-interest', keys: ['0,1,-1'] }), context),
    ).toThrow(/scope/i);
    expect(
      projectInterestControlReference(
        cancelled({ interestId: null, scope: 'whole-pending-request', keys: [] }),
        context,
      ),
    ).toMatchObject({
      status: 'cancelled',
      interestId: null,
    });
  });

  it('限制 accepted 集合，并使 null collision interest 维持为未授权请求 claim', () => {
    expect(() =>
      projectInterestControlReference(accepted({ rejected: [{ key: '0,1,-1', reason: 'not-available' }] }), context),
    ).toThrow(/duplicate/i);
    expect(() => projectInterestControlReference(accepted({ granted: [], rejected: [] }), context)).toThrow(/1.*256/i);
    expect(() =>
      projectInterestControlReference(
        accepted({ granted: [], rejected: [{ key: '0,1,-1', reason: 'unknown' }] }),
        context,
      ),
    ).toThrow(/reason/i);
    expect(() =>
      projectInterestControlReference(
        accepted({
          granted: [],
          rejected: [
            { key: '0,1,-1', reason: 'not-available' },
            { key: '0,1,-1', reason: 'residency-pressure' },
          ],
        }),
        context,
      ),
    ).toThrow(/duplicate/i);
    expect(() => projectInterestControlReference(collision({ purpose: 'mesh' }), context)).toThrow(/purpose/i);
    expect(() => projectInterestControlReference(collision({ authorized: true }), context)).toThrow(/unknown/i);
    expect(projectInterestControlReference(collision(), context)).toMatchObject({
      interestId: null,
      purpose: 'collision-resync',
    });
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('拒绝关键整数 %p', (invalid) => {
    expect(() => projectInterestControlReference(request({ requestId: invalid }), context)).toThrow(/integer/i);
    expect(() =>
      projectInterestControlReference(request({ demand: [{ key: '0,1,-1', minimumRevision: invalid }] }), context),
    ).toThrow(/integer/i);
    expect(() => projectInterestControlReference(collision({ minimumRevision: invalid }), context)).toThrow(/integer/i);
  });
});
