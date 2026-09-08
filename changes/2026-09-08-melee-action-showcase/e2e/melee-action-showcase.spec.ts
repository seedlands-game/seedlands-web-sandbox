import { expect, test } from '@playwright/test';
import { lockPointer } from '../../../tests/e2e/support/harness';
import {
  MELEE_SHOWCASE_DUMMY_IDS,
  MELEE_SHOWCASE_HOSTILE_ID,
  MELEE_SHOWCASE_SEED,
} from '../../../apps/web/src/app/gameplay/melee-action-showcase';

test('开始页一键进入木剑动作体验场并串联攻击与玩家受击反馈', async ({ page }, info) => {
  test.setTimeout(90_000);
  const capture = async (name: string) => {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
  };
  await page.goto('./?harness=1');
  await page.getByRole('button', { name: '木剑动作体验场', exact: true }).click();
  const continueDespiteWarning = page.getByRole('button', { name: '仍然进入' });
  if (await continueDespiteWarning.isVisible()) await continueDespiteWarning.click();
  await expect(page.locator('#melee-showcase-guide')).toBeVisible();
  await expect(page.getByRole('img', { name: '手持 木剑', exact: true })).toBeAttached();
  await expect(page.locator('#debug')).toContainText(`Seed ${MELEE_SHOWCASE_SEED}`);
  for (const id of [...MELEE_SHOWCASE_DUMMY_IDS, MELEE_SHOWCASE_HOSTILE_ID])
    await expect(page.locator(`[data-entity-id="${id}"]`)).toBeAttached();
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
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            ((window as Window & { __showcaseCombatEvidence?: string[] }).__showcaseCombatEvidence ?? []).some(
              (text) => text.includes('hit') && text.includes('5 点伤害'),
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
              (text) => text.includes('第 2 击') && text.includes('7 点伤害'),
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
