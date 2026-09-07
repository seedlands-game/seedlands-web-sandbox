import { describe, expect, it } from 'vitest';
import {
  validateAuthorityRequestPayload,
  validateAuthorityResponsePayload,
} from '../../src/node/runtime/node-authority-lane-protocol';

const meshKind = 'authority-capture-mesh-baseline';
const collisionKind = 'authority-capture-collision-baseline';
const cancelKind = 'authority-cancel-baseline-capture';
const request = { captureId: 1, purpose: 'mesh', key: '0,0,0', minimumRevision: 2 };
const collision = () => ({
  status: 'available',
  captureId: 1,
  captureGeneration: 0,
  purpose: 'collision-resync',
  key: '0,0,0',
  checkpoint: { epoch: 'test-epoch', physicsTick: 3, commitSequence: 7, worldRevision: 2 },
  entries: [
    {
      role: 'collision-resync',
      key: '0,0,0',
      chunkRevision: 2,
      generatorVersion: 1,
      canonical: new ArrayBuffer(65_536),
      fluid: new ArrayBuffer(32_768),
    },
  ],
});
const mesh = () => {
  const baseline = collision();
  const keys = ['0,0,0'];
  for (let y = -1; y <= 1; y++)
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) if (x || y || z) keys.push(`${x},${y},${z}`);
  return {
    ...baseline,
    purpose: 'mesh',
    entries: keys.map((key, index) => ({
      ...collision().entries[0]!,
      key,
      role: index ? 'overlay' : 'main',
    })),
  };
};

describe('Authority 完整基线 RPC 形状门禁', () => {
  it('按 operation 绑定 purpose，并拒绝未知字段和非法编号/key', () => {
    expect(validateAuthorityRequestPayload(meshKind, request).value).toEqual(request);
    expect(
      validateAuthorityRequestPayload(collisionKind, { ...request, purpose: 'collision-resync' }).value,
    ).toMatchObject({ captureId: 1 });
    expect(validateAuthorityRequestPayload(cancelKind, { captureId: 1 }).value).toEqual({ captureId: 1 });
    for (const invalid of [
      { ...request, purpose: 'collision-resync' },
      { ...request, captureId: -1 },
      { ...request, minimumRevision: NaN },
      { ...request, key: '00,0,0' },
      { ...request, extra: true },
    ])
      expect(() => validateAuthorityRequestPayload(meshKind, invalid)).toThrow();
    expect(() => validateAuthorityRequestPayload(cancelKind, { captureId: 1, purpose: 'mesh' })).toThrow();
  });

  it('available 必须携带严格 checkpoint 和独立完整块', () => {
    const valid = collision();
    expect(validateAuthorityResponsePayload(collisionKind, valid).value).toBe(valid);
    for (const mutate of [
      (value: ReturnType<typeof collision>) => {
        value.checkpoint.epoch = '';
      },
      (value: ReturnType<typeof collision>) => {
        value.checkpoint.worldRevision = -1;
      },
      (value: ReturnType<typeof collision>) => {
        value.entries[0]!.canonical = new ArrayBuffer(1);
      },
      (value: ReturnType<typeof collision>) => {
        value.entries[0]!.key = '1,0,0';
      },
      (value: ReturnType<typeof collision>) => {
        value.entries[0]!.role = 'overlay';
      },
      (value: ReturnType<typeof collision>) => {
        value.entries.push(value.entries[0]!);
      },
    ]) {
      const invalid = collision();
      mutate(invalid);
      expect(() => validateAuthorityResponsePayload(collisionKind, invalid)).toThrow();
    }
    expect(() => validateAuthorityResponsePayload(meshKind, valid)).toThrow();
    expect(() => validateAuthorityResponsePayload(collisionKind, { ...valid, checkpoint: undefined })).toThrow();
    expect(() => validateAuthorityResponsePayload(collisionKind, { ...valid, extra: true })).toThrow();
  });

  it('unavailable 和 cancel 不得携带基线，generation 与终态一致', () => {
    const unavailable = {
      status: 'unavailable',
      captureId: 1,
      captureGeneration: 0,
      purpose: 'mesh',
      key: '0,0,0',
      reason: 'cancelled',
    };
    expect(validateAuthorityResponsePayload(meshKind, unavailable).value).toBe(unavailable);
    expect(() => validateAuthorityResponsePayload(meshKind, { ...unavailable, entries: [] })).toThrow();
    expect(() => validateAuthorityResponsePayload(meshKind, { ...unavailable, reason: 'made-up' })).toThrow();
    for (const status of ['cancelled', 'already-settled']) {
      expect(
        validateAuthorityResponsePayload(cancelKind, { status, captureId: 1, captureGeneration: 0 }).value,
      ).toMatchObject({ status });
      expect(() =>
        validateAuthorityResponsePayload(cancelKind, { status, captureId: 1, captureGeneration: null }),
      ).toThrow();
    }
    expect(
      validateAuthorityResponsePayload(cancelKind, { status: 'unknown', captureId: 1, captureGeneration: null }).value,
    ).toMatchObject({ status: 'unknown' });
    expect(() =>
      validateAuthorityResponsePayload(cancelKind, { status: 'unknown', captureId: 1, captureGeneration: 0 }),
    ).toThrow();
  });

  it('27 项 mesh 不允许丢项、重排、别名、不同生成器或数组扩展', () => {
    expect(validateAuthorityResponsePayload(meshKind, mesh()).value).toMatchObject({ purpose: 'mesh' });
    for (const mutate of [
      (value: ReturnType<typeof mesh>) => {
        value.entries.pop();
      },
      (value: ReturnType<typeof mesh>) => {
        value.entries.reverse();
      },
      (value: ReturnType<typeof mesh>) => {
        value.entries[1]!.canonical = value.entries[0]!.canonical;
      },
      (value: ReturnType<typeof mesh>) => {
        value.entries[1]!.generatorVersion += 1;
      },
      (value: ReturnType<typeof mesh>) => {
        Object.assign(value.entries, { extra: true });
      },
      (value: ReturnType<typeof mesh>) => {
        Object.assign(value.entries, { [Symbol('hidden')]: true });
      },
    ]) {
      const invalid = mesh();
      mutate(invalid);
      expect(() => validateAuthorityResponsePayload(meshKind, invalid)).toThrow();
    }
    expect(() =>
      validateAuthorityRequestPayload(meshKind, { ...request, key: `${Number.MAX_SAFE_INTEGER},0,0` }),
    ).toThrow();
  });
});
