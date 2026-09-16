import type { Page } from '@playwright/test';

export type SunDirection = readonly [number, number, number];

export type GroundSample = {
  rafAt: number;
  readbackAndScanMs: number;
  mean: number;
  difference: number;
  changed: number;
  error: number;
  sunTime: number | null;
  sunDirection: [number, number, number];
};

export type GroundSampleWindow = {
  samples: GroundSample[];
  cumulativeDirectionAngleRadians: number;
  targetDirectionAngleRadians: number | null;
  reachedTarget: boolean;
  elapsedRafMs: number;
  elapsedWallMs: number;
  peakNormalizedJump: PeakNormalizedSunJump | null;
};

export type GroundSampleRequest =
  | { kind: 'frames'; frameCount: number }
  | { kind: 'angle-window'; targetDirectionAngleRadians: number; maxFrames: number; timeoutMs: number };

export type NormalizedSunMotionSample = {
  fromRafAt: number;
  toRafAt: number;
  rawDifference: number;
  directionAngleRadians: number;
  normalizedDifference: number | null;
  nearZero: boolean;
};

export type NormalizedSunMotionTailWindow = {
  fromSampleIndex: number;
  toSampleIndex: number;
  fromRafAt: number;
  toRafAt: number;
  rawDifferenceSum: number;
  directionAngleRadians: number;
  normalizedDifference: number;
};

export type PeakNormalizedSunJump = {
  fromRafAt: number;
  toRafAt: number;
  fromSunTime: number | null;
  toSunTime: number | null;
  directionAngleRadians: number;
  rawDifference: number;
  changed: number;
  normalizedDifference: number;
  beforePngDataUrl: string;
  afterPngDataUrl: string;
};

// 固定合同值：14.93h、0.04 world-hour/s、名义 60Hz 下相邻太阳方向的夹角。
export const SUN_REFERENCE_DIRECTION_STEP_RADIANS = 0.0002124550628724384;
export const SUN_TARGET_DIRECTION_TRAVEL_RADIANS = SUN_REFERENCE_DIRECTION_STEP_RADIANS * 240;
export const SUN_NEAR_ZERO_DIRECTION_STEP_RADIANS = SUN_REFERENCE_DIRECTION_STEP_RADIANS * 0.05;
export const SUN_TAIL_DIRECTION_SUPPORT_RADIANS = SUN_REFERENCE_DIRECTION_STEP_RADIANS * 2;
export const SUN_ANGLE_WINDOW_MAX_FRAMES = 1_000;
export const SUN_ANGLE_WINDOW_TIMEOUT_MS = 20_000;
export const SUN_NORMALIZED_P95_LIMIT = 0.25;
export const SUN_TAIL_NORMALIZED_MAX_LIMIT = 0.6;
export const SUN_NEAR_ZERO_RAW_LIMIT = 0.05;
export const SUN_DIRECTION_PROGRESS_RATIO_LIMIT = 0.9;

const directionAngle = (a: SunDirection, b: SunDirection) => {
  const aLength = Math.hypot(a[0], a[1], a[2]);
  const bLength = Math.hypot(b[0], b[1], b[2]);
  if (!Number.isFinite(aLength) || !Number.isFinite(bLength) || aLength <= 0 || bLength <= 0)
    throw new RangeError('太阳方向必须是有限的非零向量');
  const denominator = aLength * bLength;
  const dot = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / denominator));
  const crossX = a[1] * b[2] - a[2] * b[1];
  const crossY = a[2] * b[0] - a[0] * b[2];
  const crossZ = a[0] * b[1] - a[1] * b[0];
  const cross = Math.hypot(crossX, crossY, crossZ) / denominator;
  return Math.atan2(cross, dot);
};

export const normalizeSunMotionSamples = (
  samples: readonly GroundSample[],
  referenceDirectionStepRadians = SUN_REFERENCE_DIRECTION_STEP_RADIANS,
  nearZeroDirectionStepRadians = SUN_NEAR_ZERO_DIRECTION_STEP_RADIANS,
): NormalizedSunMotionSample[] => {
  if (!Number.isFinite(referenceDirectionStepRadians) || referenceDirectionStepRadians <= 0)
    throw new RangeError('参考太阳角位移必须为有限正数');
  if (!Number.isFinite(nearZeroDirectionStepRadians) || nearZeroDirectionStepRadians < 0)
    throw new RangeError('近零太阳角位移必须为有限非负数');
  return samples.slice(1).map((sample, index) => {
    const directionAngleRadians = directionAngle(samples[index].sunDirection, sample.sunDirection);
    const nearZero = directionAngleRadians <= nearZeroDirectionStepRadians;
    return {
      fromRafAt: samples[index].rafAt,
      toRafAt: sample.rafAt,
      rawDifference: sample.difference,
      directionAngleRadians,
      normalizedDifference: nearZero
        ? null
        : (sample.difference * referenceDirectionStepRadians) / directionAngleRadians,
      nearZero,
    };
  });
};

export const normalizeSunMotionTailWindows = (
  samples: readonly GroundSample[],
  referenceDirectionStepRadians = SUN_REFERENCE_DIRECTION_STEP_RADIANS,
  supportDirectionAngleRadians = SUN_TAIL_DIRECTION_SUPPORT_RADIANS,
): NormalizedSunMotionTailWindow[] => {
  if (!Number.isFinite(supportDirectionAngleRadians) || supportDirectionAngleRadians <= 0)
    throw new RangeError('尾项支持角必须为有限正数');
  const motion = normalizeSunMotionSamples(samples, referenceDirectionStepRadians);
  const windows: NormalizedSunMotionTailWindow[] = [];
  for (let start = 0; start < motion.length; start += 1) {
    let rawDifferenceSum = 0;
    let directionAngleRadians = 0;
    for (let end = start; end < motion.length; end += 1) {
      rawDifferenceSum += motion[end].rawDifference;
      directionAngleRadians += motion[end].directionAngleRadians;
      if (directionAngleRadians < supportDirectionAngleRadians) continue;
      windows.push({
        fromSampleIndex: start,
        toSampleIndex: end + 1,
        fromRafAt: samples[start].rafAt,
        toRafAt: samples[end + 1].rafAt,
        rawDifferenceSum,
        directionAngleRadians,
        normalizedDifference: (rawDifferenceSum * referenceDirectionStepRadians) / directionAngleRadians,
      });
      break;
    }
  }
  if (windows.length === 0) throw new RangeError('运行样本未形成完整尾项角支持窗');
  return windows;
};

export async function sampleGround(page: Page, request: GroundSampleRequest): Promise<GroundSampleWindow> {
  return page.evaluate(
    async ({ sampleRequest, referenceDirectionStepRadians, nearZeroDirectionStepRadians }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
      const gl = canvas.getContext('webgl2')!;
      const width = Math.floor(canvas.width * 0.65),
        height = Math.floor(canvas.height * 0.28);
      const pixels = new Uint8Array(width * height * 4);
      let previous: Uint8Array | null = null;
      let previousDirection: [number, number, number] | null = null;
      let cumulativeDirectionAngleRadians = 0;
      const startedAt = performance.now();
      const samples: GroundSample[] = [];
      let peakPixels:
        | {
            before: Uint8Array;
            after: Uint8Array;
            fromRafAt: number;
            toRafAt: number;
            fromSunTime: number | null;
            toSunTime: number | null;
            directionAngleRadians: number;
            rawDifference: number;
            changed: number;
            normalizedDifference: number;
          }
        | undefined;

      if (sampleRequest.kind === 'frames') {
        if (!Number.isInteger(sampleRequest.frameCount) || sampleRequest.frameCount <= 0)
          throw new RangeError('固定帧采样数必须为正整数');
      } else if (
        !Number.isFinite(sampleRequest.targetDirectionAngleRadians) ||
        sampleRequest.targetDirectionAngleRadians <= 0 ||
        !Number.isInteger(sampleRequest.maxFrames) ||
        sampleRequest.maxFrames <= 1 ||
        !Number.isFinite(sampleRequest.timeoutMs) ||
        sampleRequest.timeoutMs <= 0
      ) {
        throw new RangeError('角位移窗口参数无效');
      }

      const frameLimit = sampleRequest.kind === 'frames' ? sampleRequest.frameCount : sampleRequest.maxFrames;
      for (let frame = 0; frame < frameLimit; frame += 1) {
        const rafAt = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        const sun = (
          window as unknown as {
            __seedlandsHarness: {
              sunSnapshot(): { direction: [number, number, number]; presentedWorldTime?: number };
            };
          }
        ).__seedlandsHarness.sunSnapshot();
        const sunDirection: [number, number, number] = [...sun.direction];
        const directionLength = Math.hypot(...sunDirection);
        if (!Number.isFinite(directionLength) || directionLength <= 0) throw new Error('太阳方向采样无效');
        const readbackStartedAt = performance.now();
        const readTarget = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.readPixels(
          Math.floor(canvas.width * 0.12),
          Math.floor(canvas.height * 0.25),
          width,
          height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readTarget);
        let sum = 0,
          difference = 0,
          changed = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          sum += pixels[i + 1];
          if (previous) {
            const delta = Math.abs(pixels[i + 1] - previous[i + 1]);
            difference += delta;
            if (delta > 12) changed += 1;
          }
        }
        let nextPeakMetadata:
          | {
              fromRafAt: number;
              toRafAt: number;
              fromSunTime: number | null;
              toSunTime: number | null;
              directionAngleRadians: number;
              rawDifference: number;
              changed: number;
              normalizedDifference: number;
            }
          | undefined;
        let frameDirectionAngleRadians: number | undefined;
        if (previousDirection) {
          const aLength = Math.hypot(...previousDirection);
          const denominator = aLength * directionLength;
          const dot = Math.max(
            -1,
            Math.min(
              1,
              (previousDirection[0] * sunDirection[0] +
                previousDirection[1] * sunDirection[1] +
                previousDirection[2] * sunDirection[2]) /
                denominator,
            ),
          );
          const crossX = previousDirection[1] * sunDirection[2] - previousDirection[2] * sunDirection[1];
          const crossY = previousDirection[2] * sunDirection[0] - previousDirection[0] * sunDirection[2];
          const crossZ = previousDirection[0] * sunDirection[1] - previousDirection[1] * sunDirection[0];
          const cross = Math.hypot(crossX, crossY, crossZ) / denominator;
          frameDirectionAngleRadians = Math.atan2(cross, dot);
          cumulativeDirectionAngleRadians += frameDirectionAngleRadians;
          if (previous && frameDirectionAngleRadians > nearZeroDirectionStepRadians) {
            const normalizedDifference =
              ((difference / (width * height)) * referenceDirectionStepRadians) / frameDirectionAngleRadians;
            if (!peakPixels || normalizedDifference > peakPixels.normalizedDifference) {
              const previousSample = samples.at(-1)!;
              nextPeakMetadata = {
                fromRafAt: previousSample.rafAt,
                toRafAt: rafAt,
                fromSunTime: previousSample.sunTime,
                toSunTime: sun.presentedWorldTime ?? null,
                directionAngleRadians: frameDirectionAngleRadians,
                rawDifference: difference / (width * height),
                changed: changed / (width * height),
                normalizedDifference,
              };
            }
          }
        }
        samples.push({
          rafAt,
          readbackAndScanMs: performance.now() - readbackStartedAt,
          mean: sum / (width * height),
          difference: difference / (width * height),
          changed: changed / (width * height),
          error: gl.getError(),
          sunTime: sun.presentedWorldTime ?? null,
          sunDirection,
        });
        const currentPixels = pixels.slice();
        if (nextPeakMetadata) peakPixels = { before: previous!, after: currentPixels, ...nextPeakMetadata };
        previous = currentPixels;
        previousDirection = sunDirection;
        if (
          sampleRequest.kind === 'angle-window' &&
          (cumulativeDirectionAngleRadians >= sampleRequest.targetDirectionAngleRadians ||
            performance.now() - startedAt >= sampleRequest.timeoutMs)
        )
          break;
      }
      const targetDirectionAngleRadians =
        sampleRequest.kind === 'angle-window' ? sampleRequest.targetDirectionAngleRadians : null;
      const toPngDataUrl = (source: Uint8Array) => {
        const output = new Uint8ClampedArray(source.length);
        const rowBytes = width * 4;
        for (let row = 0; row < height; row += 1) {
          const sourceOffset = (height - row - 1) * rowBytes;
          output.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
        }
        const image = document.createElement('canvas');
        image.width = width;
        image.height = height;
        const context = image.getContext('2d');
        if (!context) throw new Error('无法创建太阳阴影峰值图像上下文');
        context.putImageData(new ImageData(output, width, height), 0, 0);
        return image.toDataURL('image/png');
      };
      const peakNormalizedJump: PeakNormalizedSunJump | null = peakPixels
        ? {
            fromRafAt: peakPixels.fromRafAt,
            toRafAt: peakPixels.toRafAt,
            fromSunTime: peakPixels.fromSunTime,
            toSunTime: peakPixels.toSunTime,
            directionAngleRadians: peakPixels.directionAngleRadians,
            rawDifference: peakPixels.rawDifference,
            changed: peakPixels.changed,
            normalizedDifference: peakPixels.normalizedDifference,
            beforePngDataUrl: toPngDataUrl(peakPixels.before),
            afterPngDataUrl: toPngDataUrl(peakPixels.after),
          }
        : null;
      return {
        samples,
        cumulativeDirectionAngleRadians,
        targetDirectionAngleRadians,
        reachedTarget:
          targetDirectionAngleRadians === null || cumulativeDirectionAngleRadians >= targetDirectionAngleRadians,
        elapsedRafMs: samples.length > 1 ? samples.at(-1)!.rafAt - samples[0].rafAt : 0,
        elapsedWallMs: performance.now() - startedAt,
        peakNormalizedJump,
      };
    },
    {
      sampleRequest: request,
      referenceDirectionStepRadians: SUN_REFERENCE_DIRECTION_STEP_RADIANS,
      nearZeroDirectionStepRadians: SUN_NEAR_ZERO_DIRECTION_STEP_RADIANS,
    },
  );
}

export const percentile = (values: readonly number[], fraction: number) => {
  if (values.length === 0) throw new RangeError('分位数样本不能为空');
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new RangeError('分位比例必须位于 0 到 1');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
