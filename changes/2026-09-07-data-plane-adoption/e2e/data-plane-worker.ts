import { createCollisionBaselineCopyCase, createGeneratedCanonicalCopyCase } from './copy-cases';
/// <reference lib="webworker" />
// @ts-expect-error -- The frozen A checkout exists only while this historical comparison runner is prepared.
import { EntityStore as OldEntityStore } from '/tmp/seedlands-adoption-baseline/src/server/gameplay/entity-store';
import { EntityStore } from '../../../src/server/gameplay/entity-store';
import {
  LogicTerrain as OldTerrain,
  validateTerrainWindows as oldValidate,
  // @ts-expect-error -- The frozen A checkout exists only while this historical comparison runner is prepared.
} from '/tmp/seedlands-adoption-baseline/src/server/logic/logic-terrain';
import { LogicTerrain, validateTerrainWindows } from '../../../src/server/logic/logic-terrain';
import type { TerrainWindow } from '../../../src/server/logic/logic-protocol';
const oldStore = new OldEntityStore();
const store = new EntityStore();
const ids: string[] = [];
for (let i = 0; i < 513; i++) {
  const input = { id: `actor-${i}`, type: 'creature' as const, position: [i, 10, 0] as [number, number, number] };
  oldStore.spawn(input);
  store.spawn(input);
  ids.push(input.id);
}
const windows: TerrainWindow[] = [
  { key: '0,0,0', chunkRevision: 1, origin: [0, 0, 0], size: [32, 32, 32], occupancy: new Uint8Array(32768) },
];
windows[0].occupancy.fill(1, 0, 32 * 32 * 9);
const smallWindows: TerrainWindow[] = [
  { key: 'small', chunkRevision: 1, origin: [0, 0, 0], size: [21, 3, 22], occupancy: new Uint8Array(1386) },
];
const oldTerrain = new OldTerrain(windows),
  terrain = new LogicTerrain(windows);
(self as DedicatedWorkerGlobalScope).onmessage = async (
  event: MessageEvent<{ mode: 'original' | 'fixed'; kind: string; count: number }>,
) => {
  const { mode, kind, count } = event.data;
  let checksum = 0;
  if (kind.startsWith('copy-')) {
    const factory = kind === 'copy-baseline' ? createCollisionBaselineCopyCase : createGeneratedCanonicalCopyCase;
    const cases = Array.from({ length: count }, () => factory());
    const started = performance.now();
    for (const item of cases) await (mode === 'original' ? item.runOriginal() : item.runFixed());
    const elapsed = performance.now() - started;
    (self as DedicatedWorkerGlobalScope).postMessage({
      elapsedMs: elapsed,
      perOperationMs: elapsed / count,
      checksum: count,
    });
    return;
  }
  const start = performance.now();
  for (let j = 0; j < count; j++) {
    if (kind.startsWith('entity-')) {
      for (const id of ids.slice(0, Number(kind.slice(7)))) {
        const update = {
          position: [1, 10, 1] as [number, number, number],
          physicsVelocity: [0, 0, 0] as [number, number, number],
        };
        if (mode === 'original') oldStore.update(id, update);
        else store.updateWithoutSnapshot(id, update);
      }
    } else if (kind.startsWith('nav-validate')) {
      (mode === 'original' ? oldValidate : validateTerrainWindows)(
        kind === 'nav-validate-small' ? smallWindows : windows,
      );
    } else if (kind === 'nav-search') {
      const result = (mode === 'original' ? oldTerrain : terrain).nextStep('player', [2.5, 9, 2.5], [24.5, 9, 24.5]);
      checksum += result?.wish.x ?? 0;
    }
  }
  const elapsed = performance.now() - start;
  (self as DedicatedWorkerGlobalScope).postMessage({ elapsedMs: elapsed, perOperationMs: elapsed / count, checksum });
};
