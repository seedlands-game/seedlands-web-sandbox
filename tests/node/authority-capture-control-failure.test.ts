import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NodeRpcClosedError } from '../../src/node/runtime/node-rpc-contract';
import {
  createAuthorityCaptureFailureFixture,
  disposeAuthorityCaptureFailureArtifacts,
} from './support/authority-capture-failure-fixtures';

const fixtures: Array<Awaited<ReturnType<typeof createAuthorityCaptureFailureFixture>>> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

afterAll(async () => {
  await disposeAuthorityCaptureFailureArtifacts();
});

describe('Node Authority capture 控制端口 failure', () => {
  it('真实 capture 已接纳时断开 control：请求立即失败，stop 等真实 cleanup，随后才退出', async () => {
    const fixture = await createAuthorityCaptureFailureFixture('normal');
    fixtures.push(fixture);
    const exited = fixture.lane.whenExited();
    void exited.catch(() => undefined);
    const capture = fixture.lane.captureBaseline(fixture.captureRequest);
    void capture.catch(() => undefined);
    await fixture.waitForComputeAcceptance();
    await fixture.closeControl();
    await expect(capture).rejects.toBeInstanceOf(NodeRpcClosedError);
    await expect(fixture.lane.whenFailed()).resolves.toMatchObject({ message: expect.stringMatching(/closed/i) });
    await fixture.waitForFatalForwarded();

    const stop = fixture.lane.stop();
    void stop.catch(() => undefined);
    const outcome = fixture.settlementBeforeRelease(stop);
    await fixture.confirmStopPending();
    await fixture.releaseCompute();
    await expect(outcome).resolves.toBe('released');
    await expect(stop).rejects.toThrow(/closed/i);
    expect(fixture.exitSettled()).toBe(false);

    await fixture.closePersistenceAndVerifyReopen();
    await fixture.teardownInner();
    await expect(fixture.lane.close()).rejects.toThrow(/closed|exited/i);
    await expect(exited).rejects.toThrow(/closed|exited/i);
  }, 60_000);

  it('负对照：桥接器若伪造提前 cleanup，oracle 会在 release 前检测到 stop 提前结算', async () => {
    const fixture = await createAuthorityCaptureFailureFixture('early-cleanup-negative-control');
    fixtures.push(fixture);
    const capture = fixture.lane.captureBaseline(fixture.captureRequest);
    void capture.catch(() => undefined);
    await fixture.waitForComputeAcceptance();
    await fixture.closeControl();
    await expect(capture).rejects.toBeInstanceOf(NodeRpcClosedError);
    await expect(fixture.lane.whenFailed()).resolves.toMatchObject({ message: expect.stringMatching(/closed/i) });

    const stop = fixture.lane.stop();
    await expect(fixture.settlementBeforeRelease(stop)).resolves.toBe('settled');
    expect(fixture.wasComputeReleased()).toBe(false);
    await fixture.releaseCompute();
    await expect(stop).rejects.toThrow(/closed/i);
  }, 60_000);
});
