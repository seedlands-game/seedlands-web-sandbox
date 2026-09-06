import { expect, test } from '@playwright/test';
import { waitForSnapshot } from '../../../tests/e2e/support/harness';

for (const profile of [
  { width: 1280, height: 720, quality: 'medium' },
  { width: 1680, height: 720, quality: 'high' },
] as const) {
  test(`${profile.quality} ${profile.width}×${profile.height} 固定标记倒影在转头后对齐镜像投影`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.goto('./?harness=1');
    await page.locator('#seed').fill('reflection-world-anchor');
    await page.locator('#quality').selectOption(profile.quality);
    await page.getByRole('button', { name: '进入世界' }).click();
    await waitForSnapshot(page, (s) => s.loadedChunks > 0);
    await page.evaluate(async () => {
      const h = window.__seedlandsHarness!;
      h.setSpectatorPosition(0, 60, 7);
      h.setView(0, -16);
      h.setWorldTime(18.35);
      h.setTimePaused(true);
      h.fillWorld({ from: [-12, 55, -16], to: [12, 63, 12], voxel: 0 });
      h.fillWorld({ from: [-12, 55, -16], to: [12, 55, 12], voxel: 3 });
      h.fillWorld({ from: [-12, 56, -16], to: [12, 56, 12], voxel: 3 });
      h.fillWorld({ from: [-11, 56, -15], to: [11, 56, 11], voxel: 0 });
      for (let x = -11; x <= 11; x++) for (let z = -15; z <= 11; z++) h.setVoxelAt(x, 56, z, 8);
      const engineUrl = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/playcanvas.js?v='))!;
      const pc = await import(engineUrl);
      const app = pc.Application.getApplication();
      const marker = new pc.Entity('Reflection anchor marker');
      marker.addComponent('render', { type: 'sphere' });
      marker.setPosition(-2, 60.875, -7);
      marker.setLocalScale(1.6, 1.6, 1.6);
      const material = new pc.StandardMaterial();
      material.useLighting = false;
      material.diffuse = new pc.Color(0, 0, 0);
      material.emissive = new pc.Color(1, 0, 1);
      material.update();
      marker.render.meshInstances[0].material = material;
      app.root.addChild(marker);
    });
    await waitForSnapshot(
      page,
      (s) =>
        s.renderedChunks > 4 &&
        s.generationQueue === 0 &&
        s.meshingQueue === 0 &&
        s.deferredRemeshes === 0 &&
        s.performance.uploadQueueDepth === 0,
    );
    await page.evaluate(() => window.__seedlandsHarness!.setSpectatorPosition(0, 60, 7));
    const measurements = [];
    for (const [yaw, pitch] of [
      [0, -16],
      [-18, -16],
      [15, -25],
    ]) {
      const expected = await page.evaluate(
        async ({ yaw, pitch }) => {
          const h = window.__seedlandsHarness!;
          h.setView(yaw, pitch);
          const engineUrl = performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((name) => name.includes('/playcanvas.js?v='))!;
          const pc = await import(engineUrl);
          const app = pc.Application.getApplication();
          for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => app.once('postrender', resolve));
          const camera = app.root.findByName('Player').camera;
          const point = camera.worldToScreen(new pc.Vec3(-2, 2 * 56.875 - 60.875, -7));
          return { x: point.x, y: point.y, width: innerWidth, height: innerHeight };
        },
        { yaw, pitch },
      );
      const shot = await page.screenshot({ path: `/tmp/reflection-anchor-${profile.quality}-${yaw}-${pitch}.png` });
      await testInfo.attach(`anchor-${yaw}-${pitch}`, { body: shot, contentType: 'image/png' });
      const result = await page.evaluate(
        async ({ bytes, expected }) => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const ex = (expected.x * canvas.width) / expected.width,
            ey = (expected.y * canvas.height) / expected.height;
          let nearest = Infinity,
            count = 0,
            sumX = 0,
            sumY = 0;
          for (let y = Math.max(0, Math.floor(ey - 110)); y < Math.min(canvas.height, ey + 110); y++)
            for (let x = 0; x < canvas.width; x++) {
              const p = (y * canvas.width + x) * 4;
              if (data[p] > 40 && data[p + 2] > 40 && data[p + 1] < Math.min(data[p], data[p + 2]) * 0.65) {
                count++;
                sumX += x;
                sumY += y;
                nearest = Math.min(nearest, Math.hypot(x - ex, y - ey));
              }
            }
          const p = (Math.round(ey) * canvas.width + Math.round(ex)) * 4;
          return {
            ex,
            ey,
            nearest,
            count,
            centroidError: Math.hypot(sumX / count - ex, sumY / count - ey),
            center: [...data.slice(p, p + 4)],
          };
        },
        { bytes: [...shot], expected },
      );
      measurements.push({ yaw, pitch, ...result });
    }
    const cachedFrames = await page.evaluate(async () => {
      const engineUrl = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/playcanvas.js?v='))!;
      const pc = await import(engineUrl);
      const app = pc.Application.getApplication();
      const reflectionCamera = app.root.findByName('Water Reflection Camera');
      const material = app.scene.layers.getLayerByName('Voxel Water').meshInstances[0].material;
      let previous = Array.from(material.getParameter('uReflectionTextureMatrix').data);
      let retained = 0;
      let captures = 0;
      let mismatches = 0;
      for (let frame = 0; frame < 24; frame++) {
        window.__seedlandsHarness!.setView(15 + frame * 0.2, -25);
        await new Promise<void>((resolve) => app.once('postrender', resolve));
        const current = Array.from(material.getParameter('uReflectionTextureMatrix').data);
        if (reflectionCamera.enabled) captures++;
        else {
          retained++;
          if (current.some((value, index) => value !== previous[index])) mismatches++;
        }
        previous = current;
      }
      return { retained, captures, mismatches };
    });
    expect(cachedFrames.mismatches).toBe(0);
    expect(cachedFrames.retained).toBeGreaterThan(12);
    expect(cachedFrames.captures).toBe(24 / (profile.quality === 'medium' ? 8 : 4));
    console.info('REFLECTION_ANCHORS', JSON.stringify(measurements));
    expect(errors).toEqual([]);
    for (const sample of measurements) {
      expect(sample.count).toBeGreaterThan(10);
      expect(sample.nearest).toBeLessThan(18);
      expect(sample.centroidError).toBeLessThan(12);
    }
  });
}
