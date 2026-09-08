import { expect, test, type Page } from '@playwright/test';
import { lockPointer } from '../../../tests/e2e/support/harness';
import {
  MELEE_SHOWCASE_DUMMY_IDS,
  MELEE_SHOWCASE_HOSTILE_ID,
  MELEE_SHOWCASE_SEED,
} from '../../../apps/web/src/app/gameplay/melee-action-showcase';

const browserQuality = process.env.SEEDLANDS_BROWSER_E2E_QUALITY ?? 'medium';
if (!['low', 'medium', 'high'].includes(browserQuality)) throw new Error('Unknown browser E2E quality.');

async function selectJourneyQuality(page: Page): Promise<void> {
  await page.selectOption('#quality', browserQuality);
  await expect(page.locator('#quality')).toHaveValue(browserQuality);
}

async function waitForPlayableScene(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__seedlandsHarness!.snapshot();
        return state.generationQueue + state.meshingQueue + state.compute.running + state.compute.queued;
      }),
    )
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 15_000;
        let previous = performance.now();
        let stable = 0;
        const frame = (now: number) => {
          stable = now - previous < 100 ? stable + 1 : 0;
          previous = now;
          if (stable >= 8) return resolve();
          if (now > deadline) return reject(new Error('Scene did not settle before timing-sensitive melee input.'));
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const evidence = await page.evaluate(() => ({
    combat: document.querySelector('#combat-status')?.textContent,
    feedback: document.querySelector('[aria-label="交互反馈"]')?.textContent,
    damage: document.querySelector('#player-damage-feedback')?.outerHTML,
    history: (window as Window & { __showcaseCombatEvidence?: string[] }).__showcaseCombatEvidence,
    snapshot: window.__seedlandsHarness?.snapshot(),
  }));
  console.log('MELEE_FAILURE_EVIDENCE', JSON.stringify(evidence));
  await info.attach('melee-failure-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('开始页一键进入木剑动作体验场并串联攻击与玩家受击反馈', async ({ page }, info) => {
  test.setTimeout(90_000);
  const capture = async (name: string) => {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
  };
  await page.goto('./?harness=1');
  await selectJourneyQuality(page);
  await page.getByRole('button', { name: '木剑动作体验场', exact: true }).click();
  const continueDespiteWarning = page.getByRole('button', { name: '仍然进入' });
  if (await continueDespiteWarning.isVisible()) await continueDespiteWarning.click();
  await expect(page.locator('#melee-showcase-guide')).toBeVisible();
  await expect(page.getByRole('img', { name: '手持 木剑', exact: true })).toBeAttached();
  await expect(page.locator('#debug')).toContainText(`Seed ${MELEE_SHOWCASE_SEED}`);
  for (const id of [...MELEE_SHOWCASE_DUMMY_IDS, MELEE_SHOWCASE_HOSTILE_ID])
    await expect(page.locator(`[data-entity-id="${id}"]`)).toBeAttached();
  await waitForPlayableScene(page);
  await capture('showcase-ready');

  await page.getByRole('button', { name: '立即触发玩家受击反馈', exact: true }).click();
  const damage = page.locator('#player-damage-feedback.visible');
  await expect(damage).toContainText('受击 -2', { timeout: 15_000 });
  await expect(page.locator('#survival-vitals.damaged')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.playerDamageFeedback().active)).toBe(true);
  await capture('player-damaged');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __seedlandsAudio?: { snapshot(): { recentSounds: { key: string }[] } } }
          ).__seedlandsAudio
            ?.snapshot()
            .recentSounds.some((sound) => sound.key === 'damage') ?? false,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: '重新布置体验场', exact: true }).click();
  for (const id of MELEE_SHOWCASE_DUMMY_IDS) await expect(page.locator(`[data-entity-id="${id}"]`)).toBeAttached();

  await lockPointer(page);
  await waitForPlayableScene(page);
  await page.evaluate(() => {
    const target = window as Window & {
      __showcaseCombatEvidence?: string[];
      __showcaseCombatObserver?: MutationObserver;
    };
    target.__showcaseCombatEvidence = [];
    const observer = new MutationObserver(() => {
      const text = `${document.querySelector('#combat-status')?.getAttribute('data-phase')} ${document.querySelector('#combat-status')?.textContent} ${document.querySelector('[aria-label="交互反馈"]')?.textContent}`;
      if (target.__showcaseCombatEvidence?.at(-1) !== text) target.__showcaseCombatEvidence?.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    target.__showcaseCombatObserver = observer;
  });
  await page.mouse.down();
  try {
    // 命中回执持久存在；当前 phase/combo 可能在同一 Authority wake 内已推进，不能要求两者同帧出现。
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            ((window as Window & { __showcaseCombatEvidence?: string[] }).__showcaseCombatEvidence ?? []).some(
              (text) => text.includes('命中') && text.includes('5 点伤害'),
            ),
          ),
        { intervals: [16, 16, 32] },
      )
      .toBe(true);
    await capture('combo-first-swing');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            ((window as Window & { __showcaseCombatEvidence?: string[] }).__showcaseCombatEvidence ?? []).some(
              (text) => text.includes('命中') && text.includes('7 点伤害'),
            ),
          ),
        { intervals: [16, 16, 32] },
      )
      .toBe(true);
    await capture('combo-reverse-swing');
  } finally {
    await page.mouse.up();
    await page.evaluate(() =>
      (window as Window & { __showcaseCombatObserver?: MutationObserver }).__showcaseCombatObserver?.disconnect(),
    );
  }
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const result = await window.__seedlandsHarness!.executeGameplayCommand({ type: 'query-entity', entityId: id });
        return (result.data as { entity: unknown }).entity;
      }, MELEE_SHOWCASE_DUMMY_IDS[1]),
    )
    .toBeNull();
});
