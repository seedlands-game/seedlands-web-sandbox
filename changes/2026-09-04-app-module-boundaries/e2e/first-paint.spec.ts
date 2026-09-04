import { expect, test } from '@playwright/test';

test('applies start-screen critical styles before the app module loads', async ({ page }) => {
  await page.route('**/src/app/main.ts*', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const firstPaint = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const ui = getComputedStyle(document.querySelector<HTMLElement>('#ui')!);
    const startCard = getComputedStyle(document.querySelector<HTMLElement>('#start-card')!);
    const hud = getComputedStyle(document.querySelector<HTMLElement>('#hud')!);
    return {
      stylesheetHrefs: Array.from(document.styleSheets).map((sheet) => sheet.href),
      expectedStylesheetHref: new URL('/assets/styles/start-screen.css', document.baseURI).href,
      bodyMargin: body.margin,
      uiPosition: ui.position,
      startCardPosition: startCard.position,
      startCardTransform: startCard.transform,
      hudDisplay: hud.display,
    };
  });

  expect(firstPaint.stylesheetHrefs).toContain(firstPaint.expectedStylesheetHref);
  expect(firstPaint.bodyMargin).toBe('0px');
  expect(firstPaint.uiPosition).toBe('fixed');
  expect(firstPaint.startCardPosition).toBe('absolute');
  expect(firstPaint.startCardTransform).not.toBe('none');
  expect(firstPaint.hudDisplay).toBe('none');
});
