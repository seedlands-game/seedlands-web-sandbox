import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import type { RemotePlayableEvidence } from '../../../apps/web/src/app/world/remote-playable-evidence';
import type { ConnectionGraphicsIdentity } from './graphics-identity-evidence';

export class JourneyProgressDiagnostics {
  private stage = 'created';
  private page: Page;
  private initial: RemotePlayableEvidence | null = null;
  private movementStart: RemotePlayableEvidence | null = null;
  private current: RemotePlayableEvidence | null = null;

  constructor(
    page: Page,
    private readonly options: Readonly<{
      outputDirectory: string;
      retry: number;
      sourceSha: string;
      readEvidence(page: Page): Promise<RemotePlayableEvidence>;
      graphicsIdentity(): ConnectionGraphicsIdentity | null;
      nodeLog(): readonly string[];
    }>,
  ) {
    this.page = page;
  }

  setStage(stage: string, page = this.page): void {
    this.stage = stage;
    this.page = page;
  }

  setInitial(initial: RemotePlayableEvidence): void {
    this.initial = initial;
    this.current = initial;
  }

  async checkpoint(stage: string, page: Page, current: RemotePlayableEvidence, movementStart = false): Promise<void> {
    this.setStage(stage, page);
    this.current = current;
    if (movementStart) this.movementStart = current;
    await this.write('progress', null);
  }

  async writeFailure(testInfo: TestInfo): Promise<void> {
    if (!this.page.isClosed()) this.current = await this.options.readEvidence(this.page).catch(() => this.current);
    const browser = await this.browserState();
    const summaryCount = this.options
      .nodeLog()
      .filter((line) => line.includes('"kind":"node-playable-input-summary"')).length;
    if (!this.page.isClosed()) await this.page.close().catch(() => undefined);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const currentCount = this.options
        .nodeLog()
        .filter((line) => line.includes('"kind":"node-playable-input-summary"')).length;
      if (currentCount > summaryCount) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    const payload = this.payload(
      'failure',
      testInfo.error?.stack ?? testInfo.error?.message ?? 'unknown failure',
      browser,
    );
    await mkdir(this.options.outputDirectory, { recursive: true });
    const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
    await writeFile(join(this.options.outputDirectory, `journey-failure-retry-${this.options.retry}.json`), body);
    await testInfo.attach('web-node-journey-failure', { body, contentType: 'application/json' });
  }

  private async write(kind: 'progress', error: null): Promise<void> {
    const payload = this.payload(kind, error, await this.browserState());
    await mkdir(this.options.outputDirectory, { recursive: true });
    await writeFile(
      join(this.options.outputDirectory, `journey-progress-retry-${this.options.retry}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  }

  private async browserState() {
    return this.page.isClosed()
      ? { pointerLock: null, focused: false, visibility: 'closed' }
      : await this.page
          .evaluate(() => ({
            pointerLock: document.pointerLockElement?.id ?? null,
            focused: document.hasFocus(),
            visibility: document.visibilityState,
          }))
          .catch(() => ({ pointerLock: null, focused: false, visibility: 'unavailable' }));
  }

  private payload(
    kind: 'progress' | 'failure',
    error: string | null,
    browser: Readonly<{ pointerLock: string | null; focused: boolean; visibility: string }>,
  ) {
    return {
      kind: `web-node-journey-${kind}`,
      sourceSha: this.options.sourceSha,
      retry: this.options.retry,
      stage: this.stage,
      initial: this.initial,
      movementStart: this.movementStart,
      current: this.current,
      browser,
      graphicsIdentity: this.options.graphicsIdentity(),
      nodeLog: this.options.nodeLog(),
      error,
    };
  }
}
