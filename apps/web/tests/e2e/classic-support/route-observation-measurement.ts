import type { Page, TestInfo } from '@playwright/test';
import type { HarnessRouteSnapshot } from '../../../src/app/gameplay/game-harness-route-observation';
import type { ClassicWindow } from './harness';
import {
  installRouteInputProbe,
  disposeRouteInputProbe,
  type RouteInputProbeWindow,
} from './route-observation-input-probe';

type Sample = Readonly<{
  phase: 'warmup' | 'aa' | 'ab';
  pair: number;
  arm: 'A' | 'B';
  elapsedMs: number;
  logicalJsonBytes: number;
  fixedOwner: string;
  physicsTick: number;
  acknowledgedInputSequence: number;
  inputEventCount: number;
}>;
const project = (value: HarnessRouteSnapshot): HarnessRouteSnapshot => ({
  player: value.player,
  serverPlayerPosition: value.serverPlayerPosition,
  serverPlayerVelocity: value.serverPlayerVelocity,
  viewAngles: value.viewAngles,
  onGround: value.onGround,
  colliding: value.colliding,
  authority: {
    physicsTick: value.authority.physicsTick,
    acknowledgedInputSequence: value.authority.acknowledgedInputSequence,
  },
});
const median = (values: readonly number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return (ordered[Math.floor((ordered.length - 1) / 2)]! + ordered[Math.floor(ordered.length / 2)]!) / 2;
};

/** Runs inside the complete canonical benchmark; never grants eligibility to a failed journey. */
export async function measureRouteObservation(
  page: Page,
  testInfo: TestInfo,
  artifactIdentity: Readonly<Record<string, unknown>>,
) {
  if (process.env.SEEDLANDS_CLASSIC_BENCHMARK !== '1' || process.env.SEEDLANDS_ROUTE_OBSERVATION_AB !== '1')
    return undefined;
  if (process.env.SEEDLANDS_PERFORMANCE_WINDOW_RESERVED !== '1')
    throw new Error('Route observation measurement requires the performance window.');
  const samples: Sample[] = [];
  let fixedOwner: string | undefined;
  let lastClock: HarnessRouteSnapshot['authority'] | undefined;
  const probeId = `${process.env.SEEDLANDS_HARNESS_RUN_ID}:${testInfo.retry}:route-observation`;
  let probeInstalled = false;
  let failed = false;
  let failure: unknown;
  let cleanupFailed = false;
  let cleanupError: unknown;
  let result: Readonly<Record<string, unknown>> = { status: 'FAIL', reason: 'measurement incomplete' };
  const startedAt = new Date().toISOString();
  try {
    await installRouteInputProbe(page, probeId);
    probeInstalled = true;
    const read = async (arm: 'A' | 'B', phase: Sample['phase'], pair: number) => {
      const started = performance.now();
      const observed = await page.evaluate(
        ({ arm, probeId }) => {
          const probe = (window as RouteInputProbeWindow).__seedlandsRouteObservationInputProbe;
          if (!probe || probe.id !== probeId) throw new Error('Route input observer ownership changed.');
          const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
          const full = harness.snapshot();
          const route = harness.routeSnapshot();
          if (!route) throw new Error('Route owner unavailable during measurement.');
          const projected = {
            player: full.player,
            serverPlayerPosition: full.serverPlayerPosition,
            serverPlayerVelocity: full.serverPlayerVelocity,
            viewAngles: full.viewAngles,
            onGround: full.onGround,
            colliding: full.colliding,
            authority: {
              physicsTick: full.authority.physicsTick,
              acknowledgedInputSequence: full.authority.acknowledgedInputSequence,
            },
          };
          if (JSON.stringify(projected) !== JSON.stringify(route))
            throw new Error('Same-task route owner projection differs.');
          const owner = JSON.stringify({
            ...projected,
            authority: undefined,
            worldRevision: full.worldRevision,
            runtime: full.runtime,
            generatorVersion: full.generatorVersion,
            quality: full.quality,
            renderPipeline: full.renderPipeline,
            requestedExperiments: full.experiments.requested,
            workers: full.workers,
          });
          return { value: arm === 'A' ? full : route, owner, inputEventCount: probe.eventCount };
        },
        { arm, probeId },
      );
      const projected = project(observed.value);
      const elapsedMs = performance.now() - started;
      const logicalJsonBytes = new TextEncoder().encode(JSON.stringify(observed.value)).byteLength;
      samples.push({
        phase,
        pair,
        arm,
        elapsedMs,
        logicalJsonBytes,
        fixedOwner: observed.owner,
        ...projected.authority,
        inputEventCount: observed.inputEventCount,
      });
      if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) throw new Error('Route observation elapsed time is invalid.');
      if (fixedOwner === undefined) fixedOwner = observed.owner;
      if (fixedOwner !== observed.owner)
        throw new Error('Input, pose or world identity changed within the measurement window.');
      if (observed.inputEventCount !== 0)
        throw new Error('Physical input events changed within the measurement window.');
      if (
        lastClock &&
        (projected.authority.physicsTick < lastClock.physicsTick ||
          projected.authority.acknowledgedInputSequence < lastClock.acknowledgedInputSequence)
      )
        throw new Error('Route authority tick or input ack regressed within the measurement window.');
      lastClock = { ...projected.authority };
      if (!projected.onGround || projected.colliding || projected.serverPlayerVelocity.some((value) => value !== 0))
        throw new Error('Route measurement requires a stationary grounded owner.');
    };
    for (let index = 0; index < 4; index++) await read(index % 2 ? 'B' : 'A', 'warmup', index);
    for (let pair = 0; pair < 8; pair++) {
      await read('A', 'aa', pair);
      await read('A', 'aa', pair);
    }
    const aa = samples.filter((sample) => sample.phase === 'aa');
    const aaLeft = median(aa.filter((_, index) => index % 2 === 0).map((sample) => sample.elapsedMs));
    const aaRight = median(aa.filter((_, index) => index % 2 === 1).map((sample) => sample.elapsedMs));
    const aaBiasPercent = (Math.abs(aaLeft - aaRight) / Math.min(aaLeft, aaRight)) * 100;
    result = { status: 'FAIL', reason: 'A/A noise veto', aaLeft, aaRight, aaBiasPercent };
    if (aaBiasPercent > 15) throw new Error('Route observation A/A exceeds the registered 15% noise veto.');
    for (let block = 0; block < 4; block++) {
      const order: readonly ('A' | 'B')[] = block % 2 ? ['B', 'A', 'A', 'B'] : ['A', 'B', 'B', 'A'];
      for (let index = 0; index < order.length; index++)
        await read(order[index]!, 'ab', block * 2 + Math.floor(index / 2));
    }
    const ab = samples.filter((sample) => sample.phase === 'ab');
    const controlMedianMs = median(ab.filter((sample) => sample.arm === 'A').map((sample) => sample.elapsedMs));
    const candidateMedianMs = median(ab.filter((sample) => sample.arm === 'B').map((sample) => sample.elapsedMs));
    const improvementPercent = ((controlMedianMs - candidateMedianMs) / controlMedianMs) * 100;
    result = {
      status: improvementPercent >= 20 ? 'PASS' : 'FAIL',
      aaLeft,
      aaRight,
      aaBiasPercent,
      controlMedianMs,
      candidateMedianMs,
      improvementPercent,
    };
    if (improvementPercent < 20)
      throw new Error('Route observation improvement is below the registered 20% threshold.');
  } catch (error) {
    failed = true;
    failure = error;
    result = { ...result, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (probeInstalled) {
      try {
        await disposeRouteInputProbe(page, probeId);
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
        result = { ...result, status: 'FAIL', cleanupError: error instanceof Error ? error.message : String(error) };
      }
    }
    const identity = await page
      .evaluate(() => {
        const snapshot = (window as unknown as ClassicWindow).__seedlandsHarness!.snapshot();
        return {
          runtime: snapshot.runtime,
          generatorVersion: snapshot.generatorVersion,
          experiments: snapshot.experiments,
          workers: snapshot.workers,
        };
      })
      .catch(() => null);
    await testInfo.attach('route-observation-measurement.json', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          schemaVersion: 1,
          ...result,
          startedAt,
          completedAt: new Date().toISOString(),
          runId: process.env.SEEDLANDS_HARNESS_RUN_ID,
          sourceSha: process.env.SEEDLANDS_SOURCE_SHA,
          windowId: process.env.SEEDLANDS_PERFORMANCE_WINDOW_ID,
          artifactIdentity,
          runtimeIdentity: identity,
          samples,
          boundary:
            'Playwright evaluate through CDP and Node route projection; same-task full/route equivalence proof included in both arms.',
          bytes: 'logical UTF-8 JSON of returned value; not CDP encoding or network bytes.',
          eligibility: 'Component result only. Whole canonical benchmark and reserved window must also pass.',
        },
        null,
        2,
      ),
    });
  }
  if (failed) throw failure;
  if (cleanupFailed) throw new Error('Route input observer cleanup failed.', { cause: cleanupError });
  return { ...result, samples };
}
