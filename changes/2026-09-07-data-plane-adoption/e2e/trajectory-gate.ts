export const TRAJECTORY_GATE_THRESHOLDS = {
  activeWindowErrorMs: 500,
  activeWindowSpreadMs: 250,
  physicsTickSpread: 12,
  checkpointHorizontalDistance: 0.75,
  checkpointVerticalSpread: 0.2,
  segmentAbsoluteSpread: 0.5,
  segmentRelativeSpread: 0.05,
  segmentMinimumDirectionCosine: 0.98,
  streamCenterChebyshevSpread: 1,
  computeTaskAbsoluteSpread: 4,
  computeTaskRelativeSpread: 0.05,
  computeBacklogSpread: 2,
} as const;

const EXPECTED_VARIANTS = ['A', 'A_PRIME', 'B'] as const;
const CHECKPOINT_KEYS = ['KeyW', 'KeyD', 'KeyS'] as const;
const POINT_KEYS = ['before', ...CHECKPOINT_KEYS, 'after'] as const;

type ExpectedVariant = (typeof EXPECTED_VARIANTS)[number];
type CheckpointKey = (typeof CHECKPOINT_KEYS)[number];
type PointKey = (typeof POINT_KEYS)[number];
type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

type AuthoritySnapshot = {
  serverPlayerPosition: Vec3;
  authority: { physicsTick: number; activeTimeMs: number };
  streamCenter: Vec2;
  compute: { submittedTasks: number; completedTasks: number };
};

type ParsedRun = {
  variant: ExpectedVariant;
  points: Record<PointKey, AuthoritySnapshot>;
};

export type TrajectoryGateRun = {
  variant: string;
  trajectory: unknown;
};

export type TrajectoryGateError = {
  scope: 'block' | 'cpu-attribution';
  code:
    | 'RUN_SET_INVALID'
    | 'TRAJECTORY_INVALID'
    | 'ACTIVE_WINDOW_DURATION'
    | 'ACTIVE_WINDOW_SPREAD'
    | 'PHYSICS_TICK_DELTA_INVALID'
    | 'PHYSICS_TICK_SPREAD'
    | 'AUTHORITY_POSITION_SPREAD'
    | 'AUTHORITY_VERTICAL_SPREAD'
    | 'SEGMENT_LENGTH_SPREAD'
    | 'SEGMENT_DIRECTION_DIVERGED'
    | 'STREAM_CENTER_SPREAD'
    | 'FINAL_STREAM_CENTER_MISMATCH'
    | 'COMPUTE_COUNTER_DELTA_INVALID'
    | 'COMPUTE_TASK_SPREAD'
    | 'COMPUTE_BACKLOG_SPREAD';
  message: string;
};

export type TrajectoryGateDiagnostics = {
  thresholds: typeof TRAJECTORY_GATE_THRESHOLDS;
  byVariant: Partial<
    Record<
      ExpectedVariant,
      {
        activeWindowMs: number;
        physicsTicks: number;
        submittedTasks: number;
        completedTasks: number;
        backlogChange: number;
      }
    >
  >;
  checkpoints: Partial<
    Record<
      PointKey,
      {
        maximumHorizontalDistance: number;
        verticalSpread: number;
        streamCenterChebyshevSpread: number;
      }
    >
  >;
  segments: Partial<
    Record<
      CheckpointKey,
      {
        lengths: Partial<Record<ExpectedVariant, number>>;
        spread: number;
        allowedSpread: number;
        minimumDirectionCosine: number;
      }
    >
  >;
};

export type TrajectoryGateResult = {
  errors: TrajectoryGateError[];
  blockErrors: TrajectoryGateError[];
  cpuAttributionErrors: TrajectoryGateError[];
  cpuAttributionValid: boolean;
  diagnostics: TrajectoryGateDiagnostics;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const finiteTuple = <N extends number>(value: unknown, length: N): value is readonly number[] & { length: N } =>
  Array.isArray(value) && value.length === length && value.every((entry) => Number.isFinite(entry));

const parseSnapshot = (value: unknown): AuthoritySnapshot | null => {
  if (!isRecord(value) || !isRecord(value.authority) || !isRecord(value.compute)) return null;
  if (!finiteTuple(value.serverPlayerPosition, 3) || !finiteTuple(value.streamCenter, 2)) return null;
  const physicsTick = value.authority.physicsTick;
  const activeTimeMs = value.authority.activeTimeMs;
  const submittedTasks = value.compute.submittedTasks;
  const completedTasks = value.compute.completedTasks;
  if (
    !Number.isSafeInteger(physicsTick) ||
    (physicsTick as number) < 0 ||
    !Number.isFinite(activeTimeMs) ||
    (activeTimeMs as number) < 0 ||
    !Number.isSafeInteger(submittedTasks) ||
    (submittedTasks as number) < 0 ||
    !Number.isSafeInteger(completedTasks) ||
    (completedTasks as number) < 0
  )
    return null;
  return {
    serverPlayerPosition: value.serverPlayerPosition as unknown as Vec3,
    authority: { physicsTick: physicsTick as number, activeTimeMs: activeTimeMs as number },
    streamCenter: value.streamCenter as unknown as Vec2,
    compute: { submittedTasks: submittedTasks as number, completedTasks: completedTasks as number },
  };
};

const parseRun = (run: TrajectoryGateRun): ParsedRun | null => {
  if (!EXPECTED_VARIANTS.includes(run.variant as ExpectedVariant) || !isRecord(run.trajectory)) return null;
  const before = parseSnapshot(run.trajectory.before);
  const after = parseSnapshot(run.trajectory.after);
  if (
    !before ||
    !after ||
    !Array.isArray(run.trajectory.checkpoints) ||
    run.trajectory.checkpoints.length !== CHECKPOINT_KEYS.length
  )
    return null;
  const checkpoints: Partial<Record<CheckpointKey, AuthoritySnapshot>> = {};
  for (const candidate of run.trajectory.checkpoints) {
    if (!isRecord(candidate) || !CHECKPOINT_KEYS.includes(candidate.key as CheckpointKey)) continue;
    const key = candidate.key as CheckpointKey;
    if (checkpoints[key]) return null;
    const snapshot = parseSnapshot(candidate.snapshot);
    if (!snapshot) return null;
    checkpoints[key] = snapshot;
  }
  if (CHECKPOINT_KEYS.some((key) => !checkpoints[key])) return null;
  return {
    variant: run.variant as ExpectedVariant,
    points: {
      before,
      KeyW: checkpoints.KeyW!,
      KeyD: checkpoints.KeyD!,
      KeyS: checkpoints.KeyS!,
      after,
    },
  };
};

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const horizontalDelta = (from: Vec3, to: Vec3): Vec2 => [to[0] - from[0], to[2] - from[2]];
const vectorLength = (vector: Vec2): number => Math.hypot(vector[0], vector[1]);

const maximumPairwise = <T>(values: readonly T[], distance: (left: T, right: T) => number): number => {
  let maximum = 0;
  for (let left = 0; left < values.length; left += 1)
    for (let right = left + 1; right < values.length; right += 1)
      maximum = Math.max(maximum, distance(values[left]!, values[right]!));
  return maximum;
};

const formatValues = (values: Readonly<Record<ExpectedVariant, number>>): string =>
  EXPECTED_VARIANTS.map((variant) => `${variant}=${values[variant].toFixed(3)}`).join(', ');

function finish(errors: TrajectoryGateError[], diagnostics: TrajectoryGateDiagnostics): TrajectoryGateResult {
  const blockErrors = errors.filter((error) => error.scope === 'block');
  const cpuAttributionErrors = errors.filter((error) => error.scope === 'cpu-attribution');
  return {
    errors,
    blockErrors,
    cpuAttributionErrors,
    cpuAttributionValid: blockErrors.length === 0 && cpuAttributionErrors.length === 0,
    diagnostics,
  };
}

export function evaluateSameBlockTrajectory(
  runs: readonly TrajectoryGateRun[],
  expectedSampleMs: number,
): TrajectoryGateResult {
  const errors: TrajectoryGateError[] = [];
  const diagnostics: TrajectoryGateDiagnostics = {
    thresholds: TRAJECTORY_GATE_THRESHOLDS,
    byVariant: {},
    checkpoints: {},
    segments: {},
  };
  const addError = (error: TrajectoryGateError) => errors.push(error);
  if (!Number.isFinite(expectedSampleMs) || expectedSampleMs <= 0)
    addError({
      scope: 'block',
      code: 'ACTIVE_WINDOW_DURATION',
      message: `非法预期采样窗口：${expectedSampleMs}ms。`,
    });

  const variants = runs.map((run) => run.variant).sort();
  if (runs.length !== EXPECTED_VARIANTS.length || variants.join(',') !== [...EXPECTED_VARIANTS].sort().join(',')) {
    addError({
      scope: 'block',
      code: 'RUN_SET_INVALID',
      message: `同 block 必须恰有 A/A_PRIME/B，实际为 ${variants.join(',') || 'NONE'}。`,
    });
  }
  const parsed = runs.map(parseRun);
  parsed.forEach((run, index) => {
    if (run) return;
    addError({
      scope: 'block',
      code: 'TRAJECTORY_INVALID',
      message: `${runs[index]?.variant ?? `run-${index + 1}`} 缺少完整、有限且唯一的权威轨迹字段。`,
    });
  });
  const validRuns = parsed.filter((run): run is ParsedRun => run !== null);
  if (validRuns.length !== EXPECTED_VARIANTS.length || new Set(validRuns.map((run) => run.variant)).size !== 3)
    return finish(errors, diagnostics);

  const byVariant = Object.fromEntries(validRuns.map((run) => [run.variant, run])) as Record<
    ExpectedVariant,
    ParsedRun
  >;
  const activeWindows = {} as Record<ExpectedVariant, number>;
  const physicsTicks = {} as Record<ExpectedVariant, number>;
  const submittedTasks = {} as Record<ExpectedVariant, number>;
  const completedTasks = {} as Record<ExpectedVariant, number>;
  const backlogChanges = {} as Record<ExpectedVariant, number>;
  for (const variant of EXPECTED_VARIANTS) {
    const { before, after } = byVariant[variant].points;
    const activeWindowMs = after.authority.activeTimeMs - before.authority.activeTimeMs;
    const tickDelta = after.authority.physicsTick - before.authority.physicsTick;
    const submittedDelta = after.compute.submittedTasks - before.compute.submittedTasks;
    const completedDelta = after.compute.completedTasks - before.compute.completedTasks;
    activeWindows[variant] = activeWindowMs;
    physicsTicks[variant] = tickDelta;
    submittedTasks[variant] = submittedDelta;
    completedTasks[variant] = completedDelta;
    backlogChanges[variant] = submittedDelta - completedDelta;
    diagnostics.byVariant[variant] = {
      activeWindowMs,
      physicsTicks: tickDelta,
      submittedTasks: submittedDelta,
      completedTasks: completedDelta,
      backlogChange: submittedDelta - completedDelta,
    };
    if (Math.abs(activeWindowMs - expectedSampleMs) > TRAJECTORY_GATE_THRESHOLDS.activeWindowErrorMs)
      addError({
        scope: 'block',
        code: 'ACTIVE_WINDOW_DURATION',
        message: `${variant} Authority activeTime 窗口 ${activeWindowMs.toFixed(3)}ms 与预期 ${expectedSampleMs.toFixed(3)}ms 的偏差超过 ${TRAJECTORY_GATE_THRESHOLDS.activeWindowErrorMs}ms。`,
      });
    if (!Number.isSafeInteger(tickDelta) || tickDelta <= 0)
      addError({
        scope: 'block',
        code: 'PHYSICS_TICK_DELTA_INVALID',
        message: `${variant} Authority physicsTick 增量无效：${tickDelta}。`,
      });
    if (submittedDelta < 0 || completedDelta < 0)
      addError({
        scope: 'cpu-attribution',
        code: 'COMPUTE_COUNTER_DELTA_INVALID',
        message: `${variant} compute counter 回退：submitted=${submittedDelta}, completed=${completedDelta}。`,
      });
  }

  if (spread(Object.values(activeWindows)) > TRAJECTORY_GATE_THRESHOLDS.activeWindowSpreadMs)
    addError({
      scope: 'block',
      code: 'ACTIVE_WINDOW_SPREAD',
      message: `同 block Authority activeTime 增量跨度超过 ${TRAJECTORY_GATE_THRESHOLDS.activeWindowSpreadMs}ms：${formatValues(activeWindows)}。`,
    });
  if (spread(Object.values(physicsTicks)) > TRAJECTORY_GATE_THRESHOLDS.physicsTickSpread)
    addError({
      scope: 'block',
      code: 'PHYSICS_TICK_SPREAD',
      message: `同 block Authority physicsTick 增量跨度超过 ${TRAJECTORY_GATE_THRESHOLDS.physicsTickSpread} ticks：${formatValues(physicsTicks)}。`,
    });

  for (const point of POINT_KEYS) {
    const snapshots = EXPECTED_VARIANTS.map((variant) => byVariant[variant].points[point]);
    const maximumHorizontalDistance = maximumPairwise(snapshots, (left, right) =>
      Math.hypot(
        left.serverPlayerPosition[0] - right.serverPlayerPosition[0],
        left.serverPlayerPosition[2] - right.serverPlayerPosition[2],
      ),
    );
    const verticalSpread = spread(snapshots.map((snapshot) => snapshot.serverPlayerPosition[1]));
    const streamCenterChebyshevSpread = maximumPairwise(snapshots, (left, right) =>
      Math.max(
        Math.abs(left.streamCenter[0] - right.streamCenter[0]),
        Math.abs(left.streamCenter[1] - right.streamCenter[1]),
      ),
    );
    diagnostics.checkpoints[point] = {
      maximumHorizontalDistance,
      verticalSpread,
      streamCenterChebyshevSpread,
    };
    if (maximumHorizontalDistance > TRAJECTORY_GATE_THRESHOLDS.checkpointHorizontalDistance)
      addError({
        scope: 'block',
        code: 'AUTHORITY_POSITION_SPREAD',
        message: `${point} 权威水平位置最大距离 ${maximumHorizontalDistance.toFixed(3)} voxel，超过 ${TRAJECTORY_GATE_THRESHOLDS.checkpointHorizontalDistance}。`,
      });
    if (verticalSpread > TRAJECTORY_GATE_THRESHOLDS.checkpointVerticalSpread)
      addError({
        scope: 'block',
        code: 'AUTHORITY_VERTICAL_SPREAD',
        message: `${point} 权威垂直位置跨度 ${verticalSpread.toFixed(3)} voxel，超过 ${TRAJECTORY_GATE_THRESHOLDS.checkpointVerticalSpread}。`,
      });
    if (streamCenterChebyshevSpread > TRAJECTORY_GATE_THRESHOLDS.streamCenterChebyshevSpread)
      addError({
        scope: 'block',
        code: 'STREAM_CENTER_SPREAD',
        message: `${point} streamCenter Chebyshev 跨度 ${streamCenterChebyshevSpread} chunks，超过 ${TRAJECTORY_GATE_THRESHOLDS.streamCenterChebyshevSpread}。`,
      });
  }

  const finalCenters = EXPECTED_VARIANTS.map((variant) => byVariant[variant].points.after.streamCenter.join(','));
  if (new Set(finalCenters).size !== 1)
    addError({
      scope: 'block',
      code: 'FINAL_STREAM_CENTER_MISMATCH',
      message: `同 block 最终 streamCenter 不同：${EXPECTED_VARIANTS.map(
        (variant, index) => `${variant}=${finalCenters[index]}`,
      ).join(', ')}。`,
    });

  const segmentStarts: readonly PointKey[] = ['before', 'KeyW', 'KeyD'];
  for (const [index, end] of CHECKPOINT_KEYS.entries()) {
    const start = segmentStarts[index]!;
    const vectors = {} as Record<ExpectedVariant, Vec2>;
    const lengths = {} as Record<ExpectedVariant, number>;
    for (const variant of EXPECTED_VARIANTS) {
      vectors[variant] = horizontalDelta(
        byVariant[variant].points[start].serverPlayerPosition,
        byVariant[variant].points[end].serverPlayerPosition,
      );
      lengths[variant] = vectorLength(vectors[variant]);
    }
    const lengthSpread = spread(Object.values(lengths));
    const allowedSpread = Math.max(
      TRAJECTORY_GATE_THRESHOLDS.segmentAbsoluteSpread,
      median(Object.values(lengths)) * TRAJECTORY_GATE_THRESHOLDS.segmentRelativeSpread,
    );
    let minimumDirectionCosine = 1;
    for (let left = 0; left < EXPECTED_VARIANTS.length; left += 1) {
      for (let right = left + 1; right < EXPECTED_VARIANTS.length; right += 1) {
        const leftVector = vectors[EXPECTED_VARIANTS[left]!]!;
        const rightVector = vectors[EXPECTED_VARIANTS[right]!]!;
        const denominator = vectorLength(leftVector) * vectorLength(rightVector);
        if (denominator > 0)
          minimumDirectionCosine = Math.min(
            minimumDirectionCosine,
            (leftVector[0] * rightVector[0] + leftVector[1] * rightVector[1]) / denominator,
          );
      }
    }
    diagnostics.segments[end] = { lengths, spread: lengthSpread, allowedSpread, minimumDirectionCosine };
    if (lengthSpread > allowedSpread)
      addError({
        scope: 'block',
        code: 'SEGMENT_LENGTH_SPREAD',
        message: `${start}→${end} 权威水平路段长度跨度 ${lengthSpread.toFixed(3)} voxel，超过 ${allowedSpread.toFixed(3)}：${formatValues(lengths)}。`,
      });
    if (minimumDirectionCosine < TRAJECTORY_GATE_THRESHOLDS.segmentMinimumDirectionCosine)
      addError({
        scope: 'block',
        code: 'SEGMENT_DIRECTION_DIVERGED',
        message: `${start}→${end} 权威运动方向最小 cosine=${minimumDirectionCosine.toFixed(5)}，低于 ${TRAJECTORY_GATE_THRESHOLDS.segmentMinimumDirectionCosine}。`,
      });
  }

  for (const [name, values] of [
    ['submittedTasks', submittedTasks],
    ['completedTasks', completedTasks],
  ] as const) {
    const allowedSpread = Math.max(
      TRAJECTORY_GATE_THRESHOLDS.computeTaskAbsoluteSpread,
      median(Object.values(values)) * TRAJECTORY_GATE_THRESHOLDS.computeTaskRelativeSpread,
    );
    const actualSpread = spread(Object.values(values));
    if (actualSpread > allowedSpread)
      addError({
        scope: 'cpu-attribution',
        code: 'COMPUTE_TASK_SPREAD',
        message: `同 block compute.${name} 增量跨度 ${actualSpread.toFixed(3)} 超过 ${allowedSpread.toFixed(3)}：${formatValues(values)}。`,
      });
  }
  if (spread(Object.values(backlogChanges)) > TRAJECTORY_GATE_THRESHOLDS.computeBacklogSpread)
    addError({
      scope: 'cpu-attribution',
      code: 'COMPUTE_BACKLOG_SPREAD',
      message: `同 block compute backlog 增量跨度超过 ${TRAJECTORY_GATE_THRESHOLDS.computeBacklogSpread}：${formatValues(backlogChanges)}。`,
    });

  return finish(errors, diagnostics);
}
