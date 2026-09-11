import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CHARACTER_ARRIVAL_RADIUS, createLifeBehavior } from '@seedlands/game-core/runtime/character-control-protocol';
import { definitionHash, faceLifeCharacter, lifeSample, startLifeScene } from './support';
import { startBrowserResidentFixture } from './resident-support';
import { assertNoModelDispatchAfterClose, validateRealThreeCompaction } from './real-three-evidence';
import type { PortableWorkspace } from '../../../apps/agent-server/src/workspace/types';

test('真实模型让三种人格分别回应玩家任务，改树后以真实身体到达各自工作地点', async ({ page, baseURL }, info) => {
  test.skip(process.env.SEEDLANDS_NPC_REAL_THREE !== '1', '显式真实三角色验收，最多18个Flash和1个Pro实际调用');
  test.setTimeout(420000);
  const runtime = await startBrowserResidentFixture(new URL(baseURL!).origin, true, 18, 1);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const journeys: unknown[] = [];
  let memoryEvidence: readonly PortableWorkspace[] = [];
  let memorySummary: ReturnType<typeof validateRealThreeCompaction> | undefined;
  let memoryValidationError: string | undefined;
  const executionWindow = {
    installedWorldTime: 0,
    elapsedSeconds: 0,
    daylightSeconds: 0,
    callsBeforeClick: 0,
    callsAtTransportClose: 0,
    callsAtServerClose: 0,
    callsAfterRetirement: 0,
    transitionCalls: 0,
    proCallsBeforeClick: 0,
    proCallsAtTransportClose: 0,
    proCallsAtServerClose: 0,
    proCallsAfterRetirement: 0,
    transitionProCalls: 0,
    clickStartedAt: 0,
    transportClosedAt: 0,
    serverClosedAt: 0,
    retiredAt: 0,
  };
  try {
    const first = await startLifeScene(page);
    const profiles = [
      {
        name: '青禾',
        personality: '沉稳务实，喜欢手头有明确的照料工作，表达简短，珍惜有限物资。',
        position: [-2.5, 57, 0.5] as const,
      },
      {
        name: '小满',
        personality: '好奇而健谈，愿意帮朋友照看营地，会主动谈论亲眼观察的变化，不假装做完未完成的事。',
        position: [0.5, 57, -3.5] as const,
      },
    ];
    const others = await page.evaluate(
      async (births) => {
        const characters = [];
        for (const birth of births) {
          const result = await window.__seedlandsHarness!.world.character({ kind: 'create', ...birth });
          if (!result.ok || result.data.kind !== 'created') throw new Error('真实三角色出生失败');
          characters.push(result.data.character);
        }
        return characters;
      },
      profiles.map(({ name, personality, position }) => ({
        profile: { name, personality },
        position,
        homePosition: position,
        behaviorTree: createLifeBehavior({
          homePosition: position,
          patrolPositions: [
            [-4.5, 57, -4.5],
            [4.5, 57, -7.5],
          ],
        }),
      })),
    );
    const characters = [first, ...others];
    const before = await Promise.all(characters.map((character) => lifeSample(page, character.entityId, 0)));
    expect(new Set(characters.map((character) => character.profile.personality)).size).toBe(3);
    await page.getByRole('button', { name: '思考设置' }).click();
    await page.locator('#companion-url').fill(runtime.host.url);
    await page.locator('#companion-token').fill(runtime.host.pairingToken);
    const socketCreated = page.waitForEvent('websocket', {
      predicate: (socket) => new URL(socket.url()).href === new URL(runtime.host.url).href,
      timeout: 15000,
    });
    await page.getByRole('button', { name: '连接', exact: true }).click();
    const residentSocket = await socketCreated;
    await expect(page.locator('#companion .connection')).toHaveText('思考服务已连接');
    const destinations = [
      [-4.5, 57, -4.5],
      [4.5, 57, -7.5],
      [-3.5, 57, 4.5],
    ] as const;
    const tasks = [
      '请去西边的 [-4.5,57,-4.5] 附近照看路口，抵达后停留至少30秒观察，再继续生活。',
      '请去东边的 [4.5,57,-7.5] 附近检查空地，抵达后停留至少30秒观察，再继续生活。',
      '请去营地的 [-3.5,57,4.5] 附近等我，抵达后停留至少30秒，再继续生活。',
    ];
    const reached = [false, false, false];
    const captureJourney = async (cursors = [0, 0, 0]) => {
      const current = await Promise.all(
        characters.map((character, index) => lifeSample(page, character.entityId, cursors[index])),
      );
      journeys.push(current);
      current.forEach((sample, index) => {
        const accepted =
          sample.observation.character.behaviorTree.revision >
            before[index].observation.character.behaviorTree.revision &&
          definitionHash(sample.observation) !== definitionHash(before[index].observation);
        if (
          accepted &&
          Math.hypot(...sample.observation.self.position.map((value, axis) => value - destinations[index][axis])) <=
            CHARACTER_ARRIVAL_RADIUS
        )
          reached[index] = true;
      });
      return current;
    };
    await page.evaluate(
      async ({ characters, tasks }) => {
        for (const [index, character] of characters.entries()) {
          const result = await window.__seedlandsHarness!.world.character({
            kind: 'dialogue',
            entityId: character.entityId,
            text: tasks[index] + '饿了先吃饭，危险时先避险。请回应我并实际调整生效行为树，不要只口头承诺。',
          });
          if (!result.ok) throw new Error('玩家任务未交付');
        }
      },
      { characters, tasks },
    );
    for (const index of characters.keys()) {
      await expect
        .poll(
          async () => {
            // An earlier resident may finish while another model is still responding.
            // Capture all three throughout cognition; pre-update patrol arrivals never count.
            const sample = (await captureJourney())[index];
            return sample.observation.character.behaviorTree.revision;
          },
          { timeout: 180000, intervals: [1000] },
        )
        .toBeGreaterThan(before[index].observation.character.behaviorTree.revision);
      await expect
        .poll(async () => (await captureJourney())[index].observation.character.lastSpeech ?? '', {
          timeout: 30000,
          intervals: [1000],
        })
        .not.toBe('');
    }
    const identity = await page.evaluate(() => window.__seedlandsHarness!.world.identity());
    if (!identity.ok) throw new Error('Disconnect world identity unavailable');
    const timelineId = await page.evaluate(
      (worldId) => localStorage.getItem(`seedlands.cognition.timeline:${worldId}`),
      identity.data.worldId,
    );
    if (!timelineId) throw new Error('Resident timeline unavailable');
    const bindings = await runtime.workspace.listBindings(identity.data.worldId, timelineId);
    expect(bindings.map((binding) => binding.actorId).sort()).toEqual(
      characters.map((character) => character.entityId).sort(),
    );
    const readMemoryEvidence = async () => {
      memoryEvidence = await Promise.all(bindings.map((binding) => runtime.workspace.exportPortable(binding)));
      memorySummary = validateRealThreeCompaction(runtime.proCalls, memoryEvidence);
      memoryValidationError = undefined;
      return memorySummary;
    };
    // Observe normal automatic compaction, if any; never invoke a compactor or pause cognition to manufacture proof.
    await expect
      .poll(
        async () => {
          await captureJourney();
          try {
            await readMemoryEvidence();
            return true;
          } catch (error) {
            memoryValidationError = error instanceof Error ? error.message : 'Compaction evidence unavailable';
            return false;
          }
        },
        { timeout: 305000, intervals: [1000], message: 'Automatic Pro compaction must be durably published' },
      )
      .toBe(true);
    const installed = await captureJourney();
    installed.forEach((sample, index) => {
      expect(definitionHash(sample.observation)).not.toBe(definitionHash(before[index].observation));
    });
    expect(new Set(installed.map((sample) => sample.observation.character.behaviorTree.goal.description)).size).toBe(3);
    executionWindow.installedWorldTime = installed[0].worldTime;
    expect(runtime.proCalls.length).toBeLessThanOrEqual(1);
    const authenticated = runtime.connectionEvents.filter((event) => event.phase === 'authenticated');
    expect(authenticated).toHaveLength(1);
    const connection = authenticated[0];
    expect(connection.world).not.toBeNull();
    expect(connection.world).toMatchObject({ worldId: identity.data.worldId, epoch: identity.data.epoch });
    executionWindow.callsBeforeClick = runtime.calls.length;
    executionWindow.proCallsBeforeClick = runtime.proCalls.length;
    executionWindow.clickStartedAt = Date.now();
    const [transportClose, retirement] = await Promise.all([
      residentSocket
        .waitForEvent('close', { timeout: 15000 })
        .then(() => ({ at: Date.now(), calls: runtime.calls.length, proCalls: runtime.proCalls.length })),
      runtime.waitForRetirement(connection.connectionId),
      page.getByRole('button', { name: '断开', exact: true }).click(),
    ]);
    const serverClose = runtime.connectionEvents.find(
      (event) => event.connectionId === connection.connectionId && event.phase === 'closed',
    );
    expect(serverClose).toBeDefined();
    executionWindow.callsAtTransportClose = transportClose.calls;
    executionWindow.callsAtServerClose = serverClose!.flashCalls;
    executionWindow.callsAfterRetirement = retirement.flashCalls;
    executionWindow.transitionCalls = transportClose.calls - executionWindow.callsBeforeClick;
    executionWindow.proCallsAtTransportClose = transportClose.proCalls;
    executionWindow.proCallsAtServerClose = serverClose!.proCalls;
    executionWindow.proCallsAfterRetirement = retirement.proCalls;
    executionWindow.transitionProCalls = transportClose.proCalls - executionWindow.proCallsBeforeClick;
    executionWindow.transportClosedAt = transportClose.at;
    executionWindow.serverClosedAt = serverClose!.at;
    executionWindow.retiredAt = retirement.at;
    expect(transportClose.calls).toBe(serverClose!.flashCalls);
    expect(retirement.flashCalls).toBe(serverClose!.flashCalls);
    expect(runtime.calls).toHaveLength(retirement.flashCalls);
    expect(transportClose.proCalls).toBe(serverClose!.proCalls);
    expect(retirement.proCalls).toBe(serverClose!.proCalls);
    expect(runtime.proCalls).toHaveLength(retirement.proCalls);
    assertNoModelDispatchAfterClose([
      { flashCalls: transportClose.calls, proCalls: transportClose.proCalls },
      serverClose!,
      retirement,
      { flashCalls: runtime.calls.length, proCalls: runtime.proCalls.length },
    ]);
    // Also catches a compaction that starts between the pre-click readback and actual socket close.
    await readMemoryEvidence();
    await expect(page.locator('#companion .connection')).toHaveText('按当前行为树生活 · 未连接模型');
    expect(await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'pause' }))).toMatchObject({
      ok: true,
    });
    const cursors = installed.map((sample) => sample.observation.cursor);
    const paused = await captureJourney(cursors);
    paused.forEach((sample) => expect(sample.paused).toBe(true));
    let previousWorldTime = paused[0].worldTime;
    const isDay = (hours: number) => hours >= 6 && hours < 18;
    // The scene advances 0.04 world-hours per simulation second. A late accepted tree
    // gets one bounded day cycle plus the original 60-second daytime action opportunity.
    for (let second = 0; second < 660 && executionWindow.daylightSeconds < 60; second++) {
      expect(
        await page.evaluate(() => window.__seedlandsHarness!.world.clock({ kind: 'advance', elapsedMs: 1000 })),
      ).toMatchObject({ ok: true });
      const current = await captureJourney(cursors);
      current.forEach((sample, index) => {
        expect(sample.paused).toBe(true);
        expect(sample.observation.gap).not.toBe(true);
        expect(sample.observation.cursor).toBeGreaterThanOrEqual(cursors[index]);
        cursors[index] = sample.observation.cursor;
        expect(sample.observation.character.lifecycle).toBe('active');
        expect(sample.observation.self.health).toBeGreaterThan(0);
        expect(definitionHash(sample.observation)).toBe(definitionHash(installed[index].observation));
        expect(sample.observation.character.behaviorTree.revision).toBe(
          installed[index].observation.character.behaviorTree.revision,
        );
      });
      executionWindow.elapsedSeconds++;
      executionWindow.daylightSeconds =
        isDay(previousWorldTime) && isDay(current[0].worldTime) ? executionWindow.daylightSeconds + 1 : 0;
      previousWorldTime = current[0].worldTime;
      expect(runtime.calls).toHaveLength(executionWindow.callsAfterRetirement);
      expect(runtime.proCalls).toHaveLength(executionWindow.proCallsAfterRetirement);
      assertNoModelDispatchAfterClose([
        retirement,
        { flashCalls: runtime.calls.length, proCalls: runtime.proCalls.length },
      ]);
    }
    expect(executionWindow.daylightSeconds).toBe(60);
    expect(reached).toEqual([true, true, true]);
    expect(runtime.proCalls.length).toBeLessThanOrEqual(1);
    await readMemoryEvidence();
    expect(runtime.calls.length).toBeLessThanOrEqual(18);
    expect(new Set(runtime.calls.map((call) => call.actorId)).size).toBe(3);
    await page.getByRole('button', { name: '思考设置' }).click();
    await expect(page.locator('#companion-url')).toBeHidden();
    for (const [index, character] of characters.entries()) {
      await page
        .getByRole('navigation', { name: '选择伙伴' })
        .getByRole('button', { name: character.profile.name, exact: true })
        .click();
      await expect(page.locator('#companion')).toContainText(
        installed[index].observation.character.behaviorTree.goal.description,
      );
      await faceLifeCharacter(page, character.entityId);
      await page.screenshot({ path: info.outputPath(`real-resident-${character.entityId}.png`) });
    }
    expect(errors).toEqual([]);
    await info.attach('real-three-outcomes', {
      body: JSON.stringify({ before, installed, reached, executionWindow }),
      contentType: 'application/json',
    });
  } finally {
    writeFileSync(info.outputPath('real-three-world-journey.json'), JSON.stringify(journeys));
    writeFileSync(info.outputPath('real-three-model-calls.json'), JSON.stringify(runtime.calls));
    writeFileSync(
      info.outputPath('real-three-pro-calls.json'),
      JSON.stringify(
        runtime.proCalls.map((call) => ({
          startedAt: call.startedAt,
          finishedAt: call.finishedAt,
          response: call.response,
        })),
      ),
    );
    writeFileSync(
      info.outputPath('real-three-memory-evidence.json'),
      JSON.stringify({ summary: memorySummary, validationError: memoryValidationError }),
    );
    writeFileSync(info.outputPath('real-three-errors.json'), JSON.stringify(errors));
    writeFileSync(info.outputPath('real-three-execution-window.json'), JSON.stringify(executionWindow));
    writeFileSync(info.outputPath('real-three-connection-events.json'), JSON.stringify(runtime.connectionEvents));
    await runtime.close();
  }
});
