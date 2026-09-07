import { describe, expect, it } from 'vitest';
import {
  authorityBaselineCaptureKeys,
  copyAuthorityBaselineCapture,
} from '../../src/server/authority/authority-baseline-capture';
import type { AuthorityBaselineCaptureRequest } from '../../src/server/authority/authority-baseline-capture-types';
import type { AuthorityCollisionBaselineResult } from '../../src/server/game-server-types';
import { CHUNK_SIZE } from '../../src/world/voxel';

const request = (overrides: Partial<AuthorityBaselineCaptureRequest> = {}): AuthorityBaselineCaptureRequest => ({
  captureId: 0,
  purpose: 'mesh',
  key: '0,0,0',
  minimumRevision: 0,
  ...overrides,
});

describe('Authority baseline capture helper', () => {
  it('以确定顺序同步复制main和完整26邻居并绑定同一次Authority checkpoint', () => {
    const keys = authorityBaselineCaptureKeys(request());
    const canonical = new Map(keys.map((key, index) => [key, new Uint16Array(CHUNK_SIZE ** 3).fill(index + 1)]));
    const fluid = new Map(keys.map((key, index) => [key, new Uint8Array(CHUNK_SIZE ** 3).fill(index)]));
    const checkpoint = { epoch: 'capture-test', physicsTick: 22, commitSequence: 12, worldRevision: 7 };
    const result = copyAuthorityBaselineCapture(request(), 3, {
      generatorVersion: 3,
      checkpoint: () => checkpoint,
      readCollisionBaseline: (key): AuthorityCollisionBaselineResult => ({
        status: 'available',
        key,
        chunkRevision: key === '0,0,0' ? 4 : 0,
        canonical: canonical.get(key)!.slice().buffer,
        fluid: fluid.get(key)!.slice().buffer,
      }),
    });

    expect(keys).toHaveLength(27);
    expect(keys[13]).toBe('0,0,0');
    expect(result).toMatchObject({
      status: 'available',
      captureId: 0,
      captureGeneration: 3,
      purpose: 'mesh',
      key: '0,0,0',
      checkpoint,
    });
    if (result.status !== 'available') throw new Error('Expected an available mesh capture.');
    expect(result.entries).toHaveLength(27);
    expect(result.entries[0]).toMatchObject({ role: 'main', key: '0,0,0', chunkRevision: 4 });
    expect(result.entries.slice(1).map((entry) => entry.key)).toEqual(keys.filter((key) => key !== '0,0,0'));
    expect(result.entries.every((entry) => entry.generatorVersion === 3)).toBe(true);
    expect(result.entries.every((entry) => entry.canonical.byteLength === CHUNK_SIZE ** 3 * 2)).toBe(true);
    expect(result.entries.every((entry) => entry.fluid.byteLength === CHUNK_SIZE ** 3)).toBe(true);

    new Uint16Array(result.entries[0].canonical)[0] = 65535;
    expect(canonical.get('0,0,0')![0]).not.toBe(65535);
    expect(result.entries[0]).not.toHaveProperty('commitSequence');
  });

  it('collision只复制单块，revision不足或同步观察期间checkpoint变化时整体不可用', () => {
    const collision = request({ captureId: 1, purpose: 'collision-resync', key: '2,-1,3', minimumRevision: 5 });
    const available = copyAuthorityBaselineCapture(collision, 4, {
      generatorVersion: 3,
      checkpoint: () => ({ epoch: 'capture-test', physicsTick: 8, commitSequence: 9, worldRevision: 2 }),
      readCollisionBaseline: (key) => ({
        status: 'available',
        key,
        chunkRevision: 5,
        canonical: new ArrayBuffer(CHUNK_SIZE ** 3 * 2),
        fluid: new ArrayBuffer(CHUNK_SIZE ** 3),
      }),
    });
    expect(available).toMatchObject({ status: 'available', entries: [{ role: 'collision-resync', key: '2,-1,3' }] });

    expect(
      copyAuthorityBaselineCapture(collision, 5, {
        generatorVersion: 3,
        checkpoint: () => ({ epoch: 'capture-test', physicsTick: 8, commitSequence: 9, worldRevision: 2 }),
        readCollisionBaseline: (key) => ({ status: 'unavailable', key }),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'not-available' });

    let checkpointRead = 0;
    expect(
      copyAuthorityBaselineCapture(collision, 6, {
        generatorVersion: 3,
        checkpoint: () => ({
          epoch: 'capture-test',
          physicsTick: 8,
          commitSequence: 9 + checkpointRead++,
          worldRevision: 2,
        }),
        readCollisionBaseline: (key) => ({
          status: 'available',
          key,
          chunkRevision: 5,
          canonical: new ArrayBuffer(CHUNK_SIZE ** 3 * 2),
          fluid: new ArrayBuffer(CHUNK_SIZE ** 3),
        }),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'superseded' });
  });

  it('在分配大数组前拒绝非法identity、key和revision', () => {
    expect(() => authorityBaselineCaptureKeys(request({ captureId: -1 }))).toThrow(/captureId/i);
    expect(() => authorityBaselineCaptureKeys(request({ key: '01,0,0' }))).toThrow(/key/i);
    expect(() => authorityBaselineCaptureKeys(request({ minimumRevision: -1 }))).toThrow(/minimumRevision/i);
    expect(() => authorityBaselineCaptureKeys(request({ key: `${Number.MAX_SAFE_INTEGER},0,0` }))).toThrow(/overflow/i);
  });
});
