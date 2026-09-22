# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/tests/e2e/classic-runtime.spec.ts >> Classic 视觉 v3 生产素材、连续帧与单击破坏回归
- Location: apps/web/tests/e2e/classic-runtime.spec.ts:522:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 3

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
    - main:
        - dialog "暂停游戏" [ref=e4]:
            - paragraph [ref=e5]: A MOMENT OF STILLNESS
            - heading "旅途暂歇" [level=2] [ref=e6]
            - paragraph [ref=e7]: 世界正在等待你
            - generic [ref=e8]:
                - button "继续游戏" [active] [ref=e9] [cursor=pointer]
                - button "设置" [ref=e10] [cursor=pointer]
                - button "操作指南" [ref=e11] [cursor=pointer]
                - button "保存并返回主菜单" [ref=e12] [cursor=pointer]
```

# Test source

```ts
  2   | import { randomUUID } from 'node:crypto';
  3   | import { classicCreatureKinds } from '../../../src/client/presentation/classic-creature-definitions';
  4   | import { browserArtifact } from './identity';
  5   | import { observeBrowserRuntime } from './evidence';
  6   | import { startClassicWorld } from './start';
  7   | import { classicScenario } from './scenario';
  8   | import { lockPointer, snapshot, voxelAt, waitForSnapshot, type ClassicWindow } from './harness';
  9   |
  10  | /** Fixed gallery for real production rendering; setup commands are not input acceptance. */
  11  | export async function verifyVisualRebuild(page: Page, testInfo: TestInfo) {
  12  |   const observed = observeBrowserRuntime(page);
  13  |   const glbs = new Set<string>();
  14  |   const renderErrors: string[] = [];
  15  |   page.on('console', (message) => {
  16  |     if (message.type() === 'error') renderErrors.push(message.text());
  17  |   });
  18  |   page.on('response', (response) => {
  19  |     if (response.ok() && response.url().includes('/models/classic/')) glbs.add(new URL(response.url()).pathname);
  20  |   });
  21  |   await startClassicWorld(page, { ...classicScenario, seed: 'classic-visual-v3', quality: 'low' });
  22  |   if (await page.locator('#debug').isVisible()) await page.keyboard.press('F3');
  23  |   await expect(page.locator('#companion')).toHaveCount(0);
  24  |   const artifact = await browserArtifact(page);
  25  |   expect(artifact.ok).toBe(true);
  26  |   const runId = process.env.SEEDLANDS_HARNESS_RUN_ID ?? randomUUID();
  27  |   await page.evaluate(
  28  |     async (kinds) => {
  29  |       const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
  30  |       const command = async (input: Record<string, unknown>) => {
  31  |         const result = await harness.world.command(input);
  32  |         if (!result.ok) throw new Error(result.error.message);
  33  |         return result.data;
  34  |       };
  35  |       const pause = await harness.world.clock({ kind: 'pause' });
  36  |       if (!pause.ok) throw new Error(pause.error.message);
  37  |       await command({ type: 'set-mode', mode: 'creative' });
  38  |       await harness.fillWorld({ from: [-12, 59, -12], to: [12, 59, 24], voxel: 3 });
  39  |       await harness.fillWorld({ from: [-12, 60, -12], to: [12, 66, 24], voxel: 0 });
  40  |       for (let i = 0; i < kinds.length; i++)
  41  |         await command({
  42  |           type: 'spawn-actor',
  43  |           id: `visual-${kinds[i]}`,
  44  |           archetype: kinds[i],
  45  |           position: [-6 + (i % 4) * 4, 60, -6 + Math.floor(i / 4) * 4],
  46  |         });
  47  |       for (const [i, voxel] of [31, 32, 33, 34, 35, 59, 61, 62].entries())
  48  |         await harness.setVoxelAt(-7 + i * 2, 60, 9, voxel);
  49  |       await command({ type: 'teleport', position: [0.5, 61.6, 19.5] });
  50  |       harness.setView(0, -8);
  51  |       harness.setTimePaused(true);
  52  |       await harness.setWorldTime(12);
  53  |     },
  54  |     [...classicCreatureKinds],
  55  |   );
  56  |   await expect.poll(() => glbs.size, { timeout: 30_000 }).toBe(12);
  57  |   await waitForSnapshot(page, (s) => s.gameplay.presentedEntityCount >= 12 && s.renderedChunks > 0);
  58  |   const capture = async (name: string) => {
  59  |     await waitForSnapshot(
  60  |       page,
  61  |       (s) => s.visualEffects.blockLightReady && s.visualEffects.blockLightSourceRevision === s.worldRevision,
  62  |     );
  63  |     await page.evaluate(async () => {
  64  |       for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  65  |     });
  66  |     await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
  67  |   };
  68  |   await capture('day-gallery');
  69  |   await page.evaluate(async () => {
  70  |     const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
  71  |     const result = await h.world.clock({ kind: 'run' });
  72  |     if (!result.ok) throw new Error(result.error.message);
  73  |   });
  74  |   await capture('animated-gallery-early');
  75  |   await capture('animated-gallery-later');
  76  |   await page.evaluate(async () => {
  77  |     const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
  78  |     await h.world.clock({ kind: 'pause' });
  79  |     await h.setWorldTime(0);
  80  |     for (const [i, voxel] of [54, 9, 27, 29, 69, 71, 73, 10].entries()) await h.setVoxelAt(-7 + i * 2, 60, 13, voxel);
  81  |   });
  82  |   await capture('night-eight-light-types');
  83  |   await page.evaluate(async () => {
  84  |     const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
  85  |     for (let i = 0; i < 8; i++) await h.setVoxelAt(-7 + i * 2, 60, 13, 0);
  86  |   });
  87  |   await capture('night-sources-removed');
  88  |   // Lock against an empty direction first: the focus click is not the break under test.
  89  |   await page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.setView(180, 0));
  90  |   await lockPointer(page);
  91  |   await page.evaluate(async () => {
  92  |     const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
  93  |     await h.setWorldTime(12);
  94  |     await h.setVoxelAt(0, 61, 17, 3);
  95  |     await h.setVoxelAt(0, 61, 16, 3);
  96  |     h.setView(0, 0);
  97  |     const result = await h.world.clock({ kind: 'run' });
  98  |     if (!result.ok) throw new Error(result.error.message);
  99  |   });
  100 |   await expect.poll(() => voxelAt(page, [0, 61, 17])).toBe(3);
  101 |   await page.mouse.click(480, 270, { delay: 40 });
> 102 |   await expect.poll(() => voxelAt(page, [0, 61, 17])).toBe(0);
      |                                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  103 |   const breakTick = (await snapshot(page))!.authority.physicsTick;
  104 |   await waitForSnapshot(page, (s) => s.authority.physicsTick >= breakTick + 20);
  105 |   expect(await voxelAt(page, [0, 61, 16])).toBe(3);
  106 |   await capture('creative-one-click-one-block');
  107 |   await page.keyboard.press('KeyE');
  108 |   await expect(page.locator('#creative-catalog')).toBeVisible();
  109 |   await testInfo.attach('creative-catalog-icons', { body: await page.screenshot(), contentType: 'image/png' });
  110 |   await page.locator('#creative-item-filter').fill('楼梯');
  111 |   await testInfo.attach('creative-stair-icons', { body: await page.screenshot(), contentType: 'image/png' });
  112 |   expect(observed.pageErrors).toEqual([]);
  113 |   expect(observed.failedResponses).toEqual([]);
  114 |   expect(renderErrors).toEqual([]);
  115 |   await testInfo.attach('visual-identity-and-observations', {
  116 |     body: JSON.stringify(
  117 |       {
  118 |         runId,
  119 |         artifact,
  120 |         glbs: [...glbs],
  121 |         snapshot: await snapshot(page),
  122 |         ...observed,
  123 |         renderErrors,
  124 |         visualReview: 'Screenshots require human/model inspection; frame capture alone does not assert art quality.',
  125 |       },
  126 |       null,
  127 |       2,
  128 |     ),
  129 |     contentType: 'application/json',
  130 |   });
  131 | }
  132 |
```
