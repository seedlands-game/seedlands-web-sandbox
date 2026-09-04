export type PerformanceProfileName = 'balanced' | 'diagnostic' | 'benchmark';

export type PerformanceProfile = {
  name: PerformanceProfileName;
  detailedTracing: boolean;
  maxMeshCommitsPerFrame: number;
  maxMeshPartsPerFrame: number;
  maxCommitMs: number;
  maxWorkerTasksInFlight: number;
  ringBufferFrames: number;
  ringBufferEvents: number;
  longFrameMs: number;
  chunkLatencyIncidentMs: number;
};

export const PERFORMANCE_PROFILES: Record<PerformanceProfileName, PerformanceProfile> = {
  balanced: {
    name: 'balanced',
    detailedTracing: false,
    maxMeshCommitsPerFrame: 1,
    maxMeshPartsPerFrame: 2,
    maxCommitMs: 4,
    maxWorkerTasksInFlight: 1,
    ringBufferFrames: 240,
    ringBufferEvents: 1024,
    longFrameMs: 33,
    chunkLatencyIncidentMs: 500,
  },
  diagnostic: {
    name: 'diagnostic',
    detailedTracing: true,
    maxMeshCommitsPerFrame: 1,
    maxMeshPartsPerFrame: 1,
    maxCommitMs: 3,
    maxWorkerTasksInFlight: 1,
    ringBufferFrames: 600,
    ringBufferEvents: 4096,
    longFrameMs: 24,
    chunkLatencyIncidentMs: 250,
  },
  benchmark: {
    name: 'benchmark',
    detailedTracing: true,
    maxMeshCommitsPerFrame: 1,
    maxMeshPartsPerFrame: 2,
    maxCommitMs: 4,
    maxWorkerTasksInFlight: 1,
    ringBufferFrames: 1200,
    ringBufferEvents: 8192,
    longFrameMs: 33,
    chunkLatencyIncidentMs: 500,
  },
};
