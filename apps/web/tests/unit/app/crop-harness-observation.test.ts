import { describe, expect, it } from 'vitest';
import type {
  AuthorityCropStageProjection,
  AuthorityGameplayView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { CropRenderBatchSnapshot } from '../../../src/app/world/playcanvas-crop-stage-adapter';
import {
  createHarnessObservability,
  type HarnessObservabilityBindings,
} from '../../../src/app/gameplay/game-harness-observability';

const projection: AuthorityCropStageProjection = {
  position: [1, 2, 3],
  stage: 7,
  presentationId: 'sample:wheat',
};
const renderedBatch: CropRenderBatchSnapshot = {
  chunkKey: '0:0:0',
  presentationId: 'sample:wheat',
  stage: 7,
  positions: [[1, 2, 3]],
  vertexCount: 8,
  indexCount: 12,
  enabled: true,
  lightingBound: true,
};

function fixture() {
  let authorityIdentity = 0;
  let ready = true;
  let runtimeEpoch = 'epoch-a';
  let gameplayRevision = 12;
  let cropStages: readonly AuthorityCropStageProjection[] = [projection];
  let gameplay = { gameplayRevision, cropStages } as unknown as AuthorityGameplayView;
  let worldEpoch: string | null = 'epoch-a';
  let batches: readonly CropRenderBatchSnapshot[] | null = [renderedBatch];
  let afterBatchRead: (() => void) | null = null;
  const authority = () => {
    const identity = authorityIdentity;
    return {
      get isReady() {
        return ready;
      },
      get runtimeEpoch() {
        return runtimeEpoch;
      },
      get gameplay() {
        return gameplay;
      },
      get voxelGeometry() {
        return undefined;
      },
      identity,
    } as unknown as NonNullable<ReturnType<HarnessObservabilityBindings['authority']>>;
  };
  let currentAuthority = authority();
  const bindings: HarnessObservabilityBindings = {
    authority: () => currentAuthority,
    renderedMaterialMesh: () => null,
    renderedWorldEpoch: () => worldEpoch,
    renderedCropBatches: () => {
      const value = batches;
      afterBatchRead?.();
      return value;
    },
    media: () => ({ worldEpoch: null, projections: [], lastForwardedBatch: null }),
    audio: () => null,
  };
  return {
    bindings,
    snapshot: () => createHarnessObservability(bindings).cropStageSnapshot(),
    setReady(value: boolean) {
      ready = value;
    },
    setRuntimeEpoch(value: string) {
      runtimeEpoch = value;
    },
    setWorldEpoch(value: string | null) {
      worldEpoch = value;
    },
    setBatches(value: readonly CropRenderBatchSnapshot[] | null) {
      batches = value;
    },
    changeAuthority() {
      authorityIdentity += 1;
      currentAuthority = authority();
    },
    changeGameplay() {
      gameplayRevision += 1;
      cropStages = [{ ...projection, position: [4, 5, 6] }];
      gameplay = { gameplayRevision, cropStages } as unknown as AuthorityGameplayView;
    },
    afterRead(callback: (() => void) | null) {
      afterBatchRead = callback;
    },
  };
}

describe('crop rendering harness observation API', () => {
  it('returns detached frozen authority crops and actual rendered mesh summaries', () => {
    const current = fixture();
    const snapshot = current.snapshot();

    expect(snapshot).toEqual({
      runtimeEpoch: 'epoch-a',
      gameplayRevision: 12,
      cropStages: [projection],
      renderedBatches: [renderedBatch],
    });
    expect(snapshot?.cropStages[0]).not.toBe(projection);
    expect(snapshot?.renderedBatches[0]).not.toBe(renderedBatch);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.cropStages)).toBe(true);
    expect(Object.isFrozen(snapshot?.cropStages[0]?.position)).toBe(true);
    expect(Object.isFrozen(snapshot?.renderedBatches[0]?.positions)).toBe(true);
    expect(Object.isFrozen(snapshot?.renderedBatches[0]?.positions[0])).toBe(true);
    expect(snapshot?.renderedBatches[0]?.vertexCount).toBe(8);
    expect(snapshot?.renderedBatches[0]?.indexCount).toBe(12);
    expect(() => {
      (snapshot!.renderedBatches[0]!.positions[0] as unknown as number[])[0] = 99;
    }).toThrow();
    expect(projection.position).toEqual([1, 2, 3]);
    expect(renderedBatch.positions).toEqual([[1, 2, 3]]);
  });

  it('rejects unready or mismatched authority and rendered-world epochs', () => {
    const current = fixture();
    current.setReady(false);
    expect(current.snapshot()).toBeNull();
    current.setReady(true);
    current.setWorldEpoch('epoch-old');
    expect(current.snapshot()).toBeNull();
    current.setWorldEpoch(null);
    expect(current.snapshot()).toBeNull();
    current.setWorldEpoch('epoch-a');
    current.setBatches(null);
    expect(current.snapshot()).toBeNull();
    current.setBatches([]);
    expect(current.snapshot()?.renderedBatches).toEqual([]);
  });

  it.each([
    ['authority identity', (current: ReturnType<typeof fixture>) => current.changeAuthority()],
    ['gameplay reference', (current: ReturnType<typeof fixture>) => current.changeGameplay()],
    ['runtime epoch', (current: ReturnType<typeof fixture>) => current.setRuntimeEpoch('epoch-b')],
    ['rendered world epoch', (current: ReturnType<typeof fixture>) => current.setWorldEpoch('epoch-b')],
  ])('rejects a %s change during the read', (_label, mutate) => {
    const current = fixture();
    current.afterRead(() => mutate(current));
    expect(current.snapshot()).toBeNull();
  });
});
