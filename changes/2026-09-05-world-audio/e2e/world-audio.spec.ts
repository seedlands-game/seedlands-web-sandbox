import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

type AudioHarness = {
  snapshot: () => {
    unlocked: boolean;
    contextState?: string;
    sharedContext: boolean;
    rms?: number;
    peak?: number;
    voices: number;
    session: string;
    cue: string;
    referenceName: string;
  };
  capture: (seconds: number) => Promise<number[]>;
};
const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __seedlandsAudio: AudioHarness }).__seedlandsAudio.snapshot());

test('生产声音共享 context、输出可录音且退出回收；本地参考曲错误可恢复', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'seedlands-audio-journey');
  await expect.poll(async () => (await snapshot(page)).unlocked).toBe(true);
  expect((await snapshot(page)).sharedContext).toBe(true);
  await expect.poll(async () => (await snapshot(page)).cue, { timeout: 14000 }).not.toBe('');
  await expect.poll(async () => (await snapshot(page)).rms, { timeout: 8000 }).toBeGreaterThan(0.00001);
  const recording = await page.evaluate(() =>
    (window as unknown as { __seedlandsAudio: AudioHarness }).__seedlandsAudio.capture(2),
  );
  expect(recording.length).toBeGreaterThan(3000);
  const recordingPath = testInfo.outputPath('production-music.webm');
  await writeFile(recordingPath, Buffer.from(recording));
  await testInfo.attach('production-music.webm', { path: recordingPath, contentType: 'audio/webm' });
  expect((await snapshot(page)).peak).toBeLessThan(0.99);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .getByLabel('选择参考曲')
    .setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await expect(page.getByRole('alert')).toContainText('无法读取');
  const bytes = await page.evaluate(() => {
    const length = 16000;
    const bytes = new ArrayBuffer(44 + length * 2);
    const view = new DataView(bytes);
    const text = (at: number, value: string) =>
      [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.sin((i * Math.PI * 440) / 16000) * 1800, true);
    return Array.from(new Uint8Array(bytes));
  });
  await page
    .getByLabel('选择参考曲')
    .setInputFiles({ name: 'local-reference.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) });
  await expect(page.locator('.reference-name')).toHaveText('local-reference.wav');
  await page.getByRole('button', { name: '移除参考曲', exact: true }).click();
  expect((await snapshot(page)).referenceName).toBe('');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await expect.poll(async () => (await snapshot(page)).session).toBe('menu');
  await expect.poll(async () => (await snapshot(page)).voices).toBe(0);
  expect((await snapshot(page)).cue).toBe('');
  expect(errors).toEqual([]);
});
