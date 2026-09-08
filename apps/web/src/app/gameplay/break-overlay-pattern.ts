export type CrackSegment = Readonly<{
  from: readonly [number, number];
  to: readonly [number, number];
}>;

const BRANCH_COUNT = 12;
const SEGMENTS_PER_BRANCH = 6;

function branchPoints(branch: number): [number, number][] {
  const angle = ((branch * 137.5 + 13) * Math.PI) / 180;
  const startRadius = 2 + (branch % 3) * 1.5;
  const start: [number, number] = [64 + Math.cos(angle * 1.7) * startRadius, 62 + Math.sin(angle * 1.3) * startRadius];
  const points = [start];
  for (let depth = 1; depth <= SEGMENTS_PER_BRANCH; depth += 1) {
    const distance = 6 + depth * 7.5;
    const jitter = Math.sin((branch + 1) * (depth + 2) * 1.73) * 4.5;
    points.push([
      start[0] + Math.cos(angle) * distance + Math.cos(angle + Math.PI / 2) * jitter,
      start[1] + Math.sin(angle) * distance + Math.sin(angle + Math.PI / 2) * jitter,
    ]);
  }
  return points;
}

const branchPaths = Array.from({ length: BRANCH_COUNT }, (_unused, branch) => branchPoints(branch));
const masterSegments: CrackSegment[] = [];
for (let depth = 0; depth < SEGMENTS_PER_BRANCH; depth += 1) {
  for (let branch = 0; branch < BRANCH_COUNT; branch += 1) {
    const points = branchPaths[branch];
    masterSegments.push({ from: points[depth], to: points[depth + 1] });
  }
}

export function crackSegmentsForStage(stage: number): readonly CrackSegment[] {
  const safeStage = Math.max(0, Math.min(9, Number.isFinite(stage) ? Math.floor(stage) : 0));
  const visibleCount = Math.floor(8 + (safeStage * (masterSegments.length - 8)) / 9);
  return masterSegments.slice(0, visibleCount);
}
