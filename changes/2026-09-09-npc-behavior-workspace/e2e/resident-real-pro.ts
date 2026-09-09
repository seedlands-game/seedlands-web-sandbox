import { writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { createResidentAgent } from '../../../apps/agent-server/src/resident-agent';
import type { startBrowserResidentFixture } from './resident-support';
import { lifeSample } from './support';

export async function validateRealPro(
  page: Page,
  runtime: Awaited<ReturnType<typeof startBrowserResidentFixture>>,
  entityId: string,
  info: TestInfo,
) {
  const identity = await page.evaluate(() => window.__seedlandsHarness!.world.identity());
  if (!identity.ok) throw new Error('world identity unavailable');
  const timelineId = await page.evaluate(
    (worldId) => localStorage.getItem(`seedlands.cognition.timeline:${worldId}`),
    identity.data.worldId,
  );
  if (!timelineId) throw new Error('resident timeline unavailable');
  const binding = (await runtime.workspace.listBindings(identity.data.worldId, timelineId)).find(
    (entry) => entry.actorId === entityId,
  );
  if (!binding) throw new Error('persistent binding unavailable');
  const before = await runtime.workspace.getActiveWindow(binding);
  const agent = createResidentAgent({
    binding,
    workspace: runtime.workspace,
    flashModel: runtime.flash,
    proModel: runtime.pro,
    checkpointer: runtime.framework.checkpointer,
    store: runtime.framework.store,
    toolSchemaRevision: 'real-validation-v1',
    modelConfigurationRevision: 'gateway-admitted-v1',
    world: {
      observe: async () => {
        throw new Error('Pro cannot operate the world');
      },
      proposeBehavior: async () => {
        throw new Error('Pro cannot propose behavior');
      },
      speak: async () => {
        throw new Error('Pro cannot speak');
      },
    },
  });
  const compaction = await agent.compactMemory({ requestId: 'real-pro-compaction', hardLimitReached: false });
  const after = await runtime.workspace.getActiveWindow(binding);
  const memory = await runtime.workspace.readFile(binding, '/MEMORY.md', 'resident');
  writeFileSync(
    info.outputPath('real-pro-compaction.json'),
    JSON.stringify({ compaction, before, after, memory, proCalls: runtime.proCalls.length }),
  );
  expect(compaction.status).toBe('published');
  expect(after.windowId).not.toBe(before.windowId);
  expect(memory.revision).toBeGreaterThan(1);
  await validateRealBirth(page, runtime, info);
}

export async function validateRealBirth(
  page: Page,
  runtime: Awaited<ReturnType<typeof startBrowserResidentFixture>>,
  info: TestInfo,
) {
  const identity = await page.evaluate(() => window.__seedlandsHarness!.world.identity());
  if (!identity.ok) throw new Error('world identity unavailable');
  const world = { worldId: identity.data.worldId, timelineId: 'real-factory-target', epoch: identity.data.epoch };
  const capabilities = await page.evaluate(() => window.__seedlandsHarness!.world.character({ kind: 'capabilities' }));
  if (!capabilities.ok || capabilities.data.kind !== 'capabilities') throw new Error('capabilities unavailable');
  const tags = ['谨慎但好奇', '喜欢照看营地', '珍惜食物与朋友'];
  const birth = await runtime.factory.generate(world, 'real-pro-birth', tags, capabilities.data.capabilities);
  const calls = runtime.proCalls.length;
  expect(await runtime.factory.generate(world, 'real-pro-birth', tags, capabilities.data.capabilities)).toEqual(birth);
  expect(runtime.proCalls).toHaveLength(calls);
  const activated = await page.evaluate(async (birth) => {
    const request = {
      kind: 'create' as const,
      creationRequestId: birth.birthId,
      profile: birth.profile,
      behaviorTree: { goal: birth.goal, definition: birth.definition },
    };
    const first = await window.__seedlandsHarness!.world.character(request);
    const duplicate = await window.__seedlandsHarness!.world.character(request);
    return { first, duplicate };
  }, birth);
  writeFileSync(
    info.outputPath('real-pro-birth.json'),
    JSON.stringify({ birth, activated, proCalls: runtime.proCalls.length }),
  );
  expect(activated.first).toMatchObject({ ok: true, data: { kind: 'created' } });
  if (!activated.first.ok || activated.first.data.kind !== 'created') throw new Error('birth rejected by Authority');
  expect(activated.duplicate).toMatchObject({
    ok: true,
    data: { character: { entityId: activated.first.data.character.entityId } },
  });
  const initial = await lifeSample(page, activated.first.data.character.entityId, 0);
  await expect
    .poll(
      async () =>
        (
          await lifeSample(
            page,
            activated.first.ok && activated.first.data.kind === 'created'
              ? activated.first.data.character.entityId
              : '',
            0,
          )
        ).physicsTick,
    )
    .toBeGreaterThan(initial.physicsTick + 120);
  await page.screenshot({ path: info.outputPath('real-pro-created-resident.png') });
}
