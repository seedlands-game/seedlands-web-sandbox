import { expect, test } from '@playwright/test';
import {
  adjustPitchToTarget,
  attackWithRealMouse,
  characterObservation,
  clickCanvasCenter,
  closeInventory,
  inventory,
  kernelCalls,
  lockPointer,
  mineVoxel,
  moveMouseBy,
  performanceTrace,
  playerState,
  prepareInitialState,
  snapshot,
  startClassicWorld,
  voxelAt,
  waitForSnapshot,
  walkTo,
  type CharacterObservation,
  type ChromeTrace,
  type ClassicWindow,
  type ClassicSnapshot,
} from './classic-support/harness';
import { browserArtifact, browserPackLock, compositionIdentity, runtimeEnvironment } from './classic-support/identity';
import { aimAtVoxelWithRealMouse } from './classic-support/aim';
import {
  attachClassicEvidence,
  attachClassicFailure,
  observeBrowserRuntime,
  requireAllClassicStages,
  type ClassicStage as Stage,
  type ClassicStageResult as StageResult,
} from './classic-support/evidence';
import { classicScenario, type Point } from './classic-support/scenario';
import { checkpointCharacter, checkpointVoxels, waitForAuthorityVoxels } from './classic-support/restore';
import { captureNpcLogicObservation, type ClassicLogicObservationEvidence } from './classic-support/logic';
import {
  completedNpcActivity,
  equipFromInventory,
  inventorySignature,
  itemCount,
  mergeRestoreEvidence,
  observedVoxel,
  traceEpoch,
} from './classic-support/journey';

const stageResults: Partial<Record<Stage, StageResult>> = {};
const stageSamples: Partial<Record<Stage, ClassicSnapshot>> = {};
const benchmarkMode = process.env.SEEDLANDS_CLASSIC_BENCHMARK === '1';
let evidenceWritten = false;
let restoreEvidence: Readonly<Record<string, unknown>> | undefined;
const logicEvidence: ClassicLogicObservationEvidence[] = [];

test.afterEach(async ({ page }, testInfo) => {
  if (evidenceWritten) return;
  const current = page.isClosed() ? null : await snapshot(page).catch(() => null);
  await attachClassicFailure(testInfo, stageResults, current, benchmarkMode, restoreEvidence, logicEvidence);
});

test('Classic 生产旅程以真实输入完成 C0-C5，并复用同一运行时性能场景', async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  evidenceWritten = false;
  restoreEvidence = undefined;
  logicEvidence.length = 0;
  for (const stage of Object.keys(stageResults) as Stage[]) delete stageResults[stage];
  for (const stage of Object.keys(stageSamples) as Stage[]) delete stageSamples[stage];

  const { pageErrors, failedResponses, assets, workers } = observeBrowserRuntime(page);

  await test.step('C0 启动固定 Classic 生产世界并冻结初态', async () => {
    await startClassicWorld(page, classicScenario);
  });
  const prepared = await prepareInitialState(page, classicScenario);
  const npcInitial = await characterObservation(page, prepared.npcId);
  const artifact = await browserArtifact(page);
  const packLock = await browserPackLock(page);
  const composition = await compositionIdentity(page);
  const environment = await runtimeEnvironment(page);
  const telemetryRunId = benchmarkMode
    ? await page.evaluate(
        (name) => (window as unknown as ClassicWindow).__seedlandsHarness!.beginPerformanceScenario(name),
        classicScenario.scenarioId,
      )
    : `${classicScenario.scenarioId}:correctness`;
  const sampleStartedAt = new Date().toISOString();
  const runId = process.env.SEEDLANDS_HARNESS_RUN_ID ?? telemetryRunId;
  const baseline = await waitForSnapshot(
    page,
    (value) =>
      value.loadedChunks > 0 &&
      value.renderedChunks > 0 &&
      value.performance.frame.count >= 1 &&
      (!benchmarkMode || value.performance.scenarioId === telemetryRunId),
    30_000,
  );

  expect(baseline.generatorVersion).toBe(classicScenario.generatorVersion);
  expect(baseline.runtime).toBe('authority-worker');
  expect(baseline.renderPipeline.backend).toBe('webgl2');
  expect(baseline.experiments.requested).toMatchObject({ renderer: 'webgl2', wasm: true, simd: true });
  expect(baseline.experiments.renderer?.effectiveRenderer).toBe('webgl2');
  expect(environment.webgl2).not.toBeNull();
  expect(baseline.workers).toMatchObject({ authority: 1, logic: 1, persistence: 1 });
  expect(baseline.workers.general).toBeGreaterThan(0);
  expect(baseline.compute.failedTasks).toBe(0);
  expect(baseline.gameplay.npcCount).toBe(1);
  expect(assets.some((path) => path.endsWith('.wasm'))).toBe(true);
  expect(workers.some((path) => /authority-worker-[\w-]+\.js$/.test(path))).toBe(true);
  expect(workers.some((path) => /world-worker-[\w-]+\.js$/.test(path))).toBe(true);
  const loadedPack = assets.some((path) => path === `/${classicScenario.runtime.packEntryPath}`);
  const artifactFiles = artifact.identity?.files ?? {};
  const loadedStampedBytes = assets
    .filter((path) => path.endsWith('.wasm') || path === `/${classicScenario.runtime.packEntryPath}`)
    .every((path) => {
      const relative = path.match(/(?:^|\/)((?:assets|packs)\/.*)$/)?.[1];
      return Boolean(relative && artifactFiles[relative]);
    });
  const classicIdentity =
    composition?.playbookId === classicScenario.playbookId &&
    composition.packLock.some(
      ({ id, version }) => id === classicScenario.playbookId && version === classicScenario.playbookVersion,
    );
  const admittedPack = packLock.lock?.packs.find(
    ({ id, version }) => id === classicScenario.playbookId && version === classicScenario.playbookVersion,
  );
  const packEntryIdentity =
    packLock.ok &&
    admittedPack?.entry.path === classicScenario.runtime.packEntryPath.replace(/^packs\//, '') &&
    artifactFiles[classicScenario.runtime.packEntryPath] === admittedPack.entry.sha256 &&
    artifactFiles[`packs/${admittedPack.manifest.path}`] === admittedPack.manifest.sha256;
  expect.soft(artifact.ok, `Production stamp unavailable: ${JSON.stringify(artifact)}`).toBe(true);
  expect.soft(loadedPack, `Loaded Pack assets: ${assets.join(', ')}`).toBe(true);
  expect.soft(loadedStampedBytes, 'Loaded Classic/Wasm bytes are absent from the production stamp.').toBe(true);
  expect.soft(packEntryIdentity, `Pack admission identity: ${JSON.stringify(packLock)}`).toBe(true);
  expect.soft(classicIdentity, `Runtime composition: ${JSON.stringify(composition)}`).toBe(true);
  stageResults.C0 = {
    status: artifact.ok && loadedPack && loadedStampedBytes && packEntryIdentity && classicIdentity ? 'PASS' : 'FAIL',
    observation:
      'Production preview loaded the fixed seed with a stamped Classic composition, Authority/logic/persistence/compute Workers, consumed Wasm bytes and an actual WebGL2 context.',
  };
  stageSamples.C0 = baseline;

  await test.step('C1 Pointer Lock、真实转向/移动/跳跃并跨越 Chunk', async () => {
    await lockPointer(page);
    const beforeTurn = (await snapshot(page))!;
    await moveMouseBy(page, 80, 0);
    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => {
        const current = (await snapshot(page))!;
        return Math.hypot(
          current.player[0] - beforeTurn.player[0],
          current.player[1] - beforeTurn.player[1],
          current.player[2] - beforeTurn.player[2],
        );
      })
      .toBeGreaterThan(1);
    await page.keyboard.up('KeyW');
    const turned = (await snapshot(page))!;
    expect(Math.abs(turned.player[2] - beforeTurn.player[2])).toBeGreaterThan(0.05);
    await moveMouseBy(page, -80, 0);
    const crossed = await walkTo(page, classicScenario.route.chunkCrossing, { jump: true, timeout: 60_000 });
    expect(crossed.streamCenter[0]).toBe(1);
    expect(crossed.authority.acknowledgedInputSequence).toBeGreaterThan(baseline.authority.acknowledgedInputSequence);
    expect(crossed.authority.physicsTick).toBeGreaterThan(baseline.authority.physicsTick);
    expect(crossed.onGround).toBe(true);
    expect(crossed.colliding).toBe(false);
    stageResults.C1 = {
      status: 'PASS',
      observation:
        'Pointer Lock mouse movement changed the route, then held W+Space crossed from Chunk 0 to Chunk 1 and Authority acknowledged it.',
    };
    stageSamples.C1 = crossed;
  });

  let minedMeshEvidence!: ClassicSnapshot;
  await test.step('C2 真实采集、掉落拾取、背包与配方', async () => {
    for (const resource of classicScenario.initialState.resourceVoxels) {
      const countBefore = itemCount(await playerState(page), resource.itemId);
      await mineVoxel(page, resource.position);
      const current = await waitForSnapshot(
        page,
        (value) => value.worldRevision > baseline.worldRevision && value.lastCommitMeshChunkCount > 0,
      );
      minedMeshEvidence = current;
      await expect(
        page.getByRole('img', { name: new RegExp(resource.itemId === 'berry' ? '浆果掉落物' : '原木掉落物') }).first(),
      ).toBeVisible();
      await walkTo(page, [resource.position[0] + 1.5, 0.5], { jump: true });
      await expect.poll(async () => itemCount(await playerState(page), resource.itemId)).toBeGreaterThan(countBefore);
    }
    const panel = await inventory(page);
    await expect(panel.getByRole('gridcell', { name: '原木 × 4', exact: true })).toBeVisible();
    await expect(panel.getByRole('gridcell', { name: '浆果 × 1', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
    await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
    await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
    await panel.getByRole('button', { name: '合成 木斧', exact: true }).click();
    await panel.getByRole('button', { name: '合成 木剑', exact: true }).click();
    await panel.getByRole('button', { name: '合成 工作台', exact: true }).click();
    await expect(panel.getByRole('gridcell', { name: /^木斧 × 1 · 耐久 60\/60$/ })).toBeVisible();
    await expect(panel.getByRole('gridcell', { name: '木剑 × 1', exact: true })).toBeVisible();
    await expect(panel.getByRole('gridcell', { name: '工作台 × 1', exact: true })).toBeVisible();
    await equipFromInventory(page, '原木');
    await closeInventory(page);
    await page.keyboard.press('Digit1');
    expect(minedMeshEvidence.remeshSchedulingCount).toBeGreaterThan(baseline.remeshSchedulingCount);
    expect(minedMeshEvidence.renderPipeline.backend).toBe('webgl2');
    stageResults.C2 = {
      status: 'PASS',
      observation:
        'Mouse mining produced visible drops; movement picked them up; E opened inventory and visible recipes produced planks, an axe, a wood sword and a workbench.',
    };
    stageSamples.C2 = (await snapshot(page))!;
  });

  await test.step('C3 真实建造、进食和现有战斗', async () => {
    const support: Point = [
      classicScenario.route.buildTarget[0],
      classicScenario.route.buildTarget[1] - 1,
      classicScenario.route.buildTarget[2],
    ];
    await adjustPitchToTarget(page, support);
    await clickCanvasCenter(page, 'right');
    await expect.poll(() => voxelAt(page, classicScenario.route.buildTarget)).toBe(4);
    const afterBuild = await waitForSnapshot(
      page,
      (value) => value.worldRevision > minedMeshEvidence.worldRevision && value.lastCommitMeshChunkCount > 0,
    );
    expect(afterBuild.remeshSchedulingCount).toBeGreaterThan(minedMeshEvidence.remeshSchedulingCount);

    const panel = await inventory(page);
    const hungerBefore = Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow'));
    expect(hungerBefore).toBeLessThan(20);
    await panel.getByRole('gridcell', { name: '浆果 × 1', exact: true }).hover();
    await panel.getByRole('button', { name: '食用浆果', exact: true }).click();
    await expect
      .poll(async () => Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow')))
      .toBeGreaterThan(hungerBefore);
    await equipFromInventory(page, '木剑');
    await closeInventory(page);
    await page.keyboard.press('Digit1');
    await walkTo(page, classicScenario.route.hostileApproach, { jump: true });
    await attackWithRealMouse(page, prepared.hostileId);
    await expect(page.locator(`[data-entity-id="${prepared.hostileId}"]`)).toHaveCount(0);

    await walkTo(page, classicScenario.route.stationApproach);
    const stationInventory = await inventory(page);
    await expect(stationInventory.getByRole('gridcell', { name: '工作台 × 1', exact: true })).toBeVisible();
    await equipFromInventory(page, '工作台');
    await closeInventory(page);
    await page.keyboard.press('Digit1');
    const stationSupport: Point = [
      classicScenario.route.stationTarget[0],
      classicScenario.route.stationTarget[1] - 1,
      classicScenario.route.stationTarget[2],
    ];
    await adjustPitchToTarget(page, stationSupport);
    await clickCanvasCenter(page, 'right');
    await expect.poll(() => voxelAt(page, classicScenario.route.stationTarget)).toBe(11);
    const afterStation = await waitForSnapshot(
      page,
      (value) => value.worldRevision > afterBuild.worldRevision && value.lastCommitMeshChunkCount > 0,
    );
    expect(afterStation.remeshSchedulingCount).toBeGreaterThan(afterBuild.remeshSchedulingCount);
    await adjustPitchToTarget(page, classicScenario.route.stationTarget);
    await clickCanvasCenter(page, 'right');
    await expect(page.getByRole('dialog', { name: '工作台' })).toBeVisible();
    await expect(page.getByRole('grid', { name: '工作台槽位' })).toBeVisible();
    await closeInventory(page);
    const workbenchBeforePickup = itemCount(await playerState(page), 'workbench');
    await mineVoxel(page, classicScenario.route.stationTarget);
    await expect(page.getByRole('img', { name: '工作台掉落物' })).toBeVisible();
    await walkTo(page, [classicScenario.route.stationTarget[0] + 1.5, 0.5], { jump: true });
    await expect
      .poll(async () => itemCount(await playerState(page), 'workbench'))
      .toBeGreaterThan(workbenchBeforePickup);
    stageResults.C3 = {
      status: 'PASS',
      observation:
        'Right click placed gathered wood with a consumed mesh commit; inventory food raised hunger; held real mouse input buffered and completed the wood-sword second combo hit before defeating the fixed creature; a crafted workbench was placed, opened through the station runtime, then dismantled and recovered through real actions.',
    };
    stageSamples.C3 = (await snapshot(page))!;
    logicEvidence.push(await captureNpcLogicObservation(page, prepared.npcId, 'C3-complete'));
  });

  let npcBeforeSave!: CharacterObservation;
  let routeTrace!: ChromeTrace;
  let sampleCompletedAt!: string;
  await test.step('C4 观察无模型 NPC 行为并离开/返回局部资源', async () => {
    const beforeTraverse = (await snapshot(page))!;
    const returnChunkX = Math.floor(classicScenario.route.returnPoint[0] / 32);
    const returnChunkPattern = new RegExp(`^${returnChunkX},[01],0$`);
    const traceBeforeTraverse = await performanceTrace(page);
    const traceIdsBeforeTraverse = new Set(
      traceBeforeTraverse.traceEvents.flatMap((event) => (event.args?.traceId ? [event.args.traceId] : [])),
    );
    const returnChunkNamesBeforeTraverse = new Set(
      traceBeforeTraverse.traceEvents.flatMap((event) =>
        event.args?.traceName && returnChunkPattern.test(event.args.traceName) ? [event.args.traceName] : [],
      ),
    );
    expect(returnChunkNamesBeforeTraverse.size).toBeGreaterThan(0);
    const observationBeforeTraverse = await characterObservation(page, prepared.npcId, npcInitial.cursor);
    logicEvidence.push(await captureNpcLogicObservation(page, prepared.npcId, 'C4-before-traverse'));
    await walkTo(page, classicScenario.route.farTurnaround, { jump: true, timeout: 90_000 });
    const far = await waitForSnapshot(
      page,
      (value) => value.streamCenter[0] - beforeTraverse.streamCenter[0] >= 4 && value.renderedChunks > 0,
      30_000,
    );
    expect(far.authority.residency).not.toBeNull();
    expect(far.loadedChunks).toBeLessThanOrEqual(beforeTraverse.loadedChunks + 8);
    expect(far.renderedChunks).toBeLessThanOrEqual(beforeTraverse.renderedChunks + 8);
    await walkTo(page, classicScenario.route.returnPoint, { key: 'KeyS', jump: true, timeout: 90_000 });
    const returned = await waitForSnapshot(
      page,
      (value) => value.streamCenter[0] === returnChunkX && value.renderedChunks > 0,
      30_000,
    );
    expect(returned.compute.completedTasks).toBeGreaterThan(baseline.compute.completedTasks);
    expect(returned.performance.completedChunkTraces).toBeGreaterThan(baseline.performance.completedChunkTraces);
    expect(kernelCalls(returned)).toBeGreaterThan(kernelCalls(baseline));
    expect(
      returned.experiments.workers.some(
        ({ lane, status, effectiveArtifact, artifactSha256 }) =>
          lane === 'general' && status === 'matched' && effectiveArtifact !== 'typescript' && Boolean(artifactSha256),
      ),
    ).toBe(true);
    routeTrace = await performanceTrace(page);
    const marksByTrace = new Map<string, { traceName: string; marks: Set<string> }>();
    for (const event of routeTrace.traceEvents) {
      const traceId = event.args?.traceId;
      const traceName = event.args?.traceName;
      if (!traceId || !traceName || traceIdsBeforeTraverse.has(traceId)) continue;
      const trace = marksByTrace.get(traceId) ?? { traceName, marks: new Set<string>() };
      trace.marks.add(event.name);
      marksByTrace.set(traceId, trace);
    }
    expect(
      [...marksByTrace.values()].some(
        ({ traceName, marks }) =>
          returnChunkNamesBeforeTraverse.has(traceName) &&
          ['worker-start', 'worker-complete', 'commit-queued', 'visible-postrender'].every((mark) => marks.has(mark)),
      ),
    ).toBe(true);
    npcBeforeSave = await characterObservation(page, prepared.npcId, observationBeforeTraverse.cursor);
    const completed = completedNpcActivity([npcInitial, observationBeforeTraverse, npcBeforeSave], 0);
    if (!completed) {
      logicEvidence.push(await captureNpcLogicObservation(page, prepared.npcId, 'C4-activity-check-failed'));
      throw new Error(
        `No matching NPC activity completion: ${JSON.stringify({ initial: npcInitial, before: observationBeforeTraverse, after: npcBeforeSave })}`,
      );
    }
    expect(npcBeforeSave.gap).not.toBe(true);
    expect(npcBeforeSave.self.position).not.toEqual(npcInitial.self.position);
    stageResults.C4 = {
      status: 'PASS',
      observation:
        'The same no-model NPC started and completed one action with body movement; real traversal shifted four Chunk centers while client resources stayed bounded, and returning produced a new trace ID for the same Chunk key through Worker completion, mesh commit and postrender visibility.',
    };
    stageSamples.C4 = returned;
  });

  await test.step('C5 正式保存返回、同上下文继续并再次交互', async () => {
    const persistedPositions = [classicScenario.route.buildTarget, classicScenario.route.stationTarget] as const;
    const stateBeforeSave = await playerState(page);
    const authorityBefore = await waitForAuthorityVoxels(page, persistedPositions);
    const checkpointBefore = await checkpointVoxels(page, persistedPositions);
    const npcCheckpointBefore = await checkpointCharacter(page, prepared.npcId);
    const derivedBefore = await Promise.all(persistedPositions.map((position) => voxelAt(page, position)));
    restoreEvidence = {
      before: {
        authority: authorityBefore,
        checkpoint: checkpointBefore,
        derived: derivedBefore,
        npcObservation: npcBeforeSave,
        npcCheckpoint: npcCheckpointBefore,
      },
    };
    expect(observedVoxel(authorityBefore, classicScenario.route.buildTarget)).toBe(4);
    expect(observedVoxel(checkpointBefore, classicScenario.route.buildTarget)).toBe(4);
    expect(npcBeforeSave.character.lifecycle).toBe('active');
    expect(npcCheckpointBefore.character?.lifecycle).toBe('active');
    expect(npcCheckpointBefore.actor?.lifecycle).toBe('alive');
    expect(npcCheckpointBefore.entity?.health).toBeGreaterThan(0);
    const identityBefore = await page.evaluate(async () => {
      const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.identity();
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      return result.data;
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '暂停游戏' })).toBeVisible();
    await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
    await page.getByRole('button', { name: '继续世界', exact: true }).click();
    const restored = await waitForSnapshot(
      page,
      (value) => value.onGround && !value.colliding && value.workers.authority === 1,
      30_000,
    );
    const identityAfter = await page.evaluate(async () => {
      const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.identity();
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      return result.data;
    });
    expect(identityAfter.epoch).not.toBe(identityBefore.epoch);
    const authorityAfter = await waitForAuthorityVoxels(page, persistedPositions);
    const derivedAfterInitial = await Promise.all(persistedPositions.map((position) => voxelAt(page, position)));
    restoreEvidence = mergeRestoreEvidence(restoreEvidence, 'after', {
      authority: authorityAfter,
      derivedInitial: derivedAfterInitial,
    });
    expect(observedVoxel(authorityAfter, classicScenario.route.buildTarget)).toBe(4);
    await expect.poll(() => voxelAt(page, classicScenario.route.buildTarget)).toBe(4);
    const derivedAfterSynchronized = await Promise.all(persistedPositions.map((position) => voxelAt(page, position)));
    restoreEvidence = mergeRestoreEvidence(restoreEvidence, 'after', {
      derivedSynchronized: derivedAfterSynchronized,
    });
    expect(derivedAfterSynchronized[0]).toBe(4);
    expect(await voxelAt(page, classicScenario.route.stationTarget)).toBe(0);
    expect(inventorySignature(await playerState(page))).toEqual(inventorySignature(stateBeforeSave));
    const npcAfter = await characterObservation(page, prepared.npcId);
    const npcCheckpointAfter = await checkpointCharacter(page, prepared.npcId);
    restoreEvidence = mergeRestoreEvidence(restoreEvidence, 'after', {
      npcObservation: npcAfter,
      npcCheckpoint: npcCheckpointAfter,
    });
    expect(npcAfter.character.lifecycle).toBe('active');
    expect(npcCheckpointAfter.character?.lifecycle).toBe('active');
    expect(npcCheckpointAfter.actor?.lifecycle).toBe('alive');
    expect(npcCheckpointAfter.entity?.health).toBeGreaterThan(0);
    expect(npcAfter.character.entityId).toBe(npcBeforeSave.character.entityId);
    const restoredInventory = await inventory(page);
    await expect(restoredInventory.getByRole('gridcell', { name: '工作台 × 1', exact: true })).toBeVisible();
    await equipFromInventory(page, '工作台');
    await closeInventory(page);
    await page.keyboard.press('Digit1');
    const stationSupport: Point = [
      classicScenario.route.stationTarget[0],
      classicScenario.route.stationTarget[1] - 1,
      classicScenario.route.stationTarget[2],
    ];
    const supportAim = await aimAtVoxelWithRealMouse(page, stationSupport);
    restoreEvidence = mergeRestoreEvidence(restoreEvidence, 'after', { realMouseAim: { support: supportAim } });
    await clickCanvasCenter(page, 'right');
    await expect.poll(() => voxelAt(page, classicScenario.route.stationTarget)).toBe(11);
    const stationAim = await aimAtVoxelWithRealMouse(page, classicScenario.route.stationTarget);
    restoreEvidence = mergeRestoreEvidence(restoreEvidence, 'after', {
      realMouseAim: { support: supportAim, station: stationAim },
    });
    await clickCanvasCenter(page, 'right');
    await expect(page.getByRole('dialog', { name: '工作台' })).toBeVisible();
    await expect(page.getByRole('grid', { name: '工作台槽位' })).toBeVisible();
    await closeInventory(page);
    const ackBefore = restored.authority.acknowledgedInputSequence;
    const positionBefore = restored.player;
    await page.keyboard.down('KeyW');
    try {
      await waitForSnapshot(
        page,
        (value) =>
          value.authority.acknowledgedInputSequence > ackBefore &&
          Math.hypot(value.player[0] - positionBefore[0], value.player[2] - positionBefore[2]) > 0.5,
      );
    } finally {
      await page.keyboard.up('KeyW');
    }
    stageResults.C5 = {
      status: 'PASS',
      observation:
        'Save and return created a fresh epoch, restored build/workbench/inventory/NPC identity, reacquired and reopened the station through visible target-card readback plus real mouse input, and accepted a new real movement input.',
    };
    stageSamples.C5 = (await snapshot(page))!;
    const preRestoreTrace = traceEpoch(routeTrace, identityBefore.epoch, 'C0-C4');
    const postRestoreTrace = traceEpoch(await performanceTrace(page), identityAfter.epoch, 'C5');
    routeTrace = { traceEvents: [...preRestoreTrace.traceEvents, ...postRestoreTrace.traceEvents] };
    sampleCompletedAt = new Date().toISOString();
  });

  const final = (await snapshot(page))!;
  await attachClassicEvidence(testInfo, {
    scenario: classicScenario,
    stages: stageResults,
    benchmarkMode,
    stageSamples,
    runId,
    artifact,
    packLock,
    composition,
    environment,
    assets: [...new Set(assets)],
    workers: [...new Set(workers)],
    baseline,
    final,
    trace: routeTrace,
    pageErrors,
    failedResponses,
    restoreEvidence,
    sampleStartedAt,
    sampleCompletedAt,
  });
  evidenceWritten = true;
  requireAllClassicStages(stageResults);
  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
