import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('灯笼实例化实验采集与视觉准入记录（不启用候选）', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/changes/2026-09-08-asset-appearance-center/e2e/render-fixture.html');
  const rows = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./lantern-instancing-probe')).run(),
    '/changes/2026-09-08-asset-appearance-center/e2e/lantern-instancing-probe.ts',
  );
  expect(errors).toEqual([]);
  expect(rows).toHaveLength(16);
  for (const row of rows) {
    if (row.offscreen || row.count === 0) expect(row.drawCalls).toBe(0);
    else expect(row.drawCalls).toBeGreaterThan(0);
    const peer = rows.find(
      (other) => other.mode !== row.mode && other.count === row.count && other.offscreen === row.offscreen,
    )!;
    expect(row.triangles).toBe(peer.triangles);
    if (row.png)
      await writeFile(info.outputPath(`lantern-${row.mode}.png`), Buffer.from(row.png.split(',')[1], 'base64'));
  }
  const result = rows.map(({ png: _png, ...row }) => row);
  await writeFile(info.outputPath('lantern-instancing.json'), JSON.stringify(result, null, 2));
  // Image decoding is outside every timing sample. A submitted draw is not proof
  // that geometry is visible; record this gate independently of collector health.
  const visibility = await page.evaluate(
    async (frames) => {
      return Promise.all(
        frames.map(async ({ mode, png }) => {
          const image = new Image();
          image.src = png;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          let foregroundPixels = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 12)
              foregroundPixels++;
          }
          return { mode, foregroundPixels };
        }),
      );
    },
    rows.filter((row): row is typeof row & { png: string } => Boolean(row.png)),
  );
  expect(visibility.find((row) => row.mode === 'baseline')!.foregroundPixels).toBeGreaterThan(100);
  await writeFile(
    info.outputPath('lantern-instancing-visual-gate.json'),
    JSON.stringify(
      {
        visibility,
        candidateHasVisibleGeometry: visibility.find((row) => row.mode === 'instanced')!.foregroundPixels > 100,
        adopted: false,
        note: '采集成功不等于候选视觉正确或性能验收通过；生产仍使用 Chunk 合批。',
      },
      null,
      2,
    ),
  );
});
