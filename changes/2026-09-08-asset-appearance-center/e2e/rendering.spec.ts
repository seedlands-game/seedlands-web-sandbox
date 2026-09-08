import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const probes = '/changes/2026-09-08-asset-appearance-center/e2e/render-probes.ts';
test('灯笼共享渲染、材质批次着色与编辑视角保持', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/changes/2026-09-08-asset-appearance-center/e2e/render-fixture.html');
  const result = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).lanternFrames(),
    probes,
  );
  expect(result.cameraPreserved).toBe(true);
  for (const [name, frame] of Object.entries(result.frames)) {
    const bytes = Buffer.from(frame.split(',')[1], 'base64');
    expect(bytes.byteLength).toBeGreaterThan(4000);
    await writeFile(info.outputPath(`lantern-${name}.png`), bytes);
  }
  expect(errors).toEqual([]);
});
