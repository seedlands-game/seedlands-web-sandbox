import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('导出三首完整生产合成 Cue 与波形指标供独立试听', async ({ browser, baseURL }, testInfo) => {
  test.skip(process.env.SEEDLANDS_AUDIO_AUDITION !== '1', '完整音频导出约100秒，须显式执行。');
  test.setTimeout(150_000);
  const reports = await Promise.all(
    (['meadow', 'waterside', 'night'] as const).map(async (preset) => {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await page.route('**/audio-cue-audit', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button id="play">生成完整试听</button>' }),
      );
      await page.goto('./audio-cue-audit');
      await page.evaluate(async (presetName) => {
        const modulePath = '/src/app/audio/global-audio.ts';
        const { GlobalAudio } = await import(modulePath);
        const audio = new GlobalAudio();
        const auditWindow = window as unknown as {
          recording: Promise<{ bytes: number[]; peak: number; rms: number; sharedContext: boolean; cue: string }>;
        };
        auditWindow.recording = new Promise((resolve, reject) => {
          document.querySelector('button')!.onclick = async () => {
            try {
              await audio.unlock();
              const graph = audio.graph;
              const destination = graph.context.createMediaStreamDestination();
              graph.output.connect(destination);
              const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
              const chunks: Blob[] = [];
              let peak = 0,
                rms = 0;
              const timer = setInterval(() => {
                const sample = graph.snapshot();
                peak = Math.max(peak, sample.peak);
                rms = Math.max(rms, sample.rms);
              }, 100);
              recorder.ondataavailable = (event) => {
                if (event.data.size) chunks.push(event.data);
              };
              recorder.onstop = async () => {
                clearInterval(timer);
                const snapshot = audio.snapshot();
                audio.music.stop(true);
                graph.output.disconnect(destination);
                destination.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
                resolve({
                  bytes: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
                  peak,
                  rms,
                  sharedContext: snapshot.sharedContext,
                  cue: snapshot.cue,
                });
              };
              recorder.start();
              audio.music.start(presetName, 42);
              setTimeout(() => recorder.stop(), 100_000);
            } catch (error) {
              reject(error);
            }
          };
        });
      }, preset);
      await page.getByRole('button', { name: '生成完整试听' }).click();
      const result = await page.evaluate(
        () =>
          (
            window as unknown as {
              recording: Promise<{ bytes: number[]; peak: number; rms: number; sharedContext: boolean; cue: string }>;
            }
          ).recording,
      );
      const path = testInfo.outputPath(`${preset}-full-cue.webm`);
      writeFileSync(path, Buffer.from(result.bytes));
      const exportDir = process.env.SEEDLANDS_AUDIO_EXPORT_DIR;
      if (exportDir) {
        mkdirSync(exportDir, { recursive: true });
        copyFileSync(path, join(exportDir, `${preset}-full-cue.webm`));
      }
      await testInfo.attach(`${preset}-full-cue`, { path, contentType: 'audio/webm' });
      await context.close();
      expect(result.sharedContext).toBe(true);
      expect(result.peak).toBeLessThan(0.99);
      expect(result.rms).toBeGreaterThan(0.0001);
      expect(result.bytes.length).toBeGreaterThan(10000);
      return {
        preset,
        peak: result.peak,
        rms: result.rms,
        sharedContext: result.sharedContext,
        cue: result.cue,
        bytes: result.bytes.length,
      };
    }),
  );
  await testInfo.attach('cue-waveform-metrics', {
    body: JSON.stringify(reports, null, 2),
    contentType: 'application/json',
  });
});
