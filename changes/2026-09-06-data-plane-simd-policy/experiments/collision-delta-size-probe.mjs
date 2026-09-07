// 从任意目录运行：
// node changes/2026-09-06-data-plane-simd-policy/experiments/collision-delta-size-probe.mjs
// v8.serialize 结果仅是 Node V8 对象图尺寸代理。
import { serialize } from 'node:v8';

const counts = [1, 8, 64, 192, 1024, 32768];
const results = counts.map((count) => {
  const delta = {
    committed: true,
    worldRevision: 1,
    structuralChange: {
      chunks: ['0,0,0'],
      chunkRevisions: [{ key: '0,0,0', revision: 1 }],
    },
    collisionDelta: [
      {
        key: '0,0,0',
        previousRevision: 0,
        revision: 1,
        cells: Array.from({ length: count }, (_, index) => ({
          index,
          voxel: index % 12,
          fluid: index % 256,
        })),
      },
    ],
  };
  return {
    n: count,
    v8SerializedBytes: serialize(delta).byteLength,
    soaPayloadBytes:
      count * (Uint32Array.BYTES_PER_ELEMENT + Uint16Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT),
  };
});

console.log(JSON.stringify(results, null, 2));
