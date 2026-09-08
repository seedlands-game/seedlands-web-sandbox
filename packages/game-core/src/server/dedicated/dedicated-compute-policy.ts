import type { DedicatedComputeSchedulePolicy, DedicatedComputeWork } from '../compute/dedicated-compute-scheduler';

/** canonical 按 Chunk 合并，流体租约独立结算，Logic 仅替换尚未执行的观察。 */
export function dedicatedComputePolicy(work: DedicatedComputeWork): DedicatedComputeSchedulePolicy {
  switch (work.kind) {
    case 'generate-canonical':
      return { priority: 'near', key: work.key, revision: `${work.generatorVersion}:0` };
    case 'find-safe-spawn':
      return { priority: 'interaction', key: 'safe-spawn', revision: String(work.generatorVersion) };
    case 'fluid':
      return { priority: 'interaction', key: work.snapshot.workId, revision: String(work.snapshot.epoch) };
    case 'logic':
      return {
        priority: 'background',
        key: 'logic-observation',
        revision: String(work.observation.observationSequence),
      };
  }
}
