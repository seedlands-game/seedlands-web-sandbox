import { describe, expect, it } from 'vitest';
import { PERFORMANCE_PROFILES } from '../../src/client/performance-profile';

describe('客户端性能 profile', () => {
  it('为 balanced、diagnostic 与 benchmark 提供有界预算和诊断阈值', () => {
    expect(Object.keys(PERFORMANCE_PROFILES).sort()).toEqual(['balanced', 'benchmark', 'diagnostic']);
    for (const profile of Object.values(PERFORMANCE_PROFILES)) {
      expect(profile.maxMeshCommitsPerFrame).toBeGreaterThan(0);
      expect(profile.maxMeshCommitsPerFrame).toBeLessThanOrEqual(2);
      expect(profile.maxWorkerTasksInFlight).toBeGreaterThan(0);
      expect(profile.ringBufferFrames).toBeGreaterThan(0);
      expect(profile.longFrameMs).toBeGreaterThan(0);
    }
    expect(PERFORMANCE_PROFILES.diagnostic.detailedTracing).toBe(true);
    expect(PERFORMANCE_PROFILES.balanced.detailedTracing).toBe(false);
  });
});
