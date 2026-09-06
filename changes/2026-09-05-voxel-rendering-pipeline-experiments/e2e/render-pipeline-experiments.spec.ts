import { expect, test } from '@playwright/test';
import {
  moveHarnessPlayer,
  removeHarnessVoxel,
  snapshot,
  startHarnessWorld,
  waitForSnapshot,
} from '../../../tests/e2e/support/harness';

test('最终渲染管线完成加载、跨 Chunk、编辑 remesh 与 postrender-visible', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) pageErrors.push(message.text());
  });
  await startHarnessWorld(page, 'render-pipeline-final');
  const loaded = await waitForSnapshot(
    page,
    (current) =>
      current.loadedChunks >= 49 &&
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.performance.uploadQueueDepth === 0 &&
      current.performance.visibleAfterPostrender,
  );
  expect(loaded.renderPipeline).toEqual({
    drawUnit: 'chunk-render-category',
    batchMode: 'category',
    vertexLayout: 'float16-uv-uint16-index',
    shaderMode: 'voxel-array-chunks',
    backend: 'webgl2',
  });
  expect(loaded.drawCalls).toBeLessThanOrEqual(loaded.renderedChunks * 3);
  expect(loaded.triangles).toBeGreaterThan(0);
  expect(loaded.performance.estimatedMeshBytes).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('final-render-pipeline.png') });

  await moveHarnessPlayer(page, 40, 34, 0);
  await waitForSnapshot(page, (current) => current.streamCenter[0] === 1);
  const beforeEdit = await snapshot(page);
  await removeHarnessVoxel(page, 0, 0, 0);
  const remeshed = await waitForSnapshot(
    page,
    (current) => current.mutationCount > 0 && current.performance.visibleAfterPostrender,
  );
  expect(remeshed.mutationCount).toBeGreaterThan(beforeEdit?.mutationCount ?? 0);

  await moveHarnessPlayer(page, 256, 34, 0);
  const afterUnload = await waitForSnapshot(
    page,
    (current) =>
      current.streamCenter[0] === 8 &&
      current.loadedChunks > 0 &&
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.performance.uploadQueueDepth === 0,
  );
  expect(afterUnload.loadedChunks).toBeLessThanOrEqual(loaded.loadedChunks + 2);
  expect(afterUnload.renderedChunks).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
