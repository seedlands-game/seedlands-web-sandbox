import { chromium, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type CpuProfile = {
  startTime: number;
  endTime: number;
  nodes: Array<{
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

export type TargetInfo = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type HeapUsage = { usedSize: number; totalSize: number; embedderHeapUsedSize: number; backingStorageSize: number };

export type ProfileCapture = {
  target: Omit<TargetInfo, 'webSocketDebuggerUrl'>;
  role: string;
  profile: CpuProfile;
  heapUsage: HeapUsage | 'UNSUPPORTED';
  profileDurationMs: number;
  expectedWindowMs: number;
  durationDeltaMs: number;
};

const PROFILE_DURATION_TOLERANCE_MS = 250;
const PROFILE_DURATION_SPREAD_TOLERANCE_MS = 100;

export class RawCdp {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed.'));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP target closed.'));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<RawCdp> {
    const socket = new WebSocket(url);
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error(`无法连接 CDP target：${url}`)), { once: true });
      }),
      5_000,
      '连接 CDP target 超过 5 秒。',
    );
    return new RawCdp(socket);
  }

  send<T>(method: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

export const targetRole = (target: TargetInfo): string => {
  if (target.type === 'page') return 'main';
  if (target.url.includes('authority-worker')) return 'authority';
  if (target.url.includes('game-logic-worker')) return 'logic';
  if (target.url.includes('fluid-compute-worker')) return 'fluid';
  if (target.url.includes('persistence-worker')) return 'persistence';
  if (target.url.includes('world-worker')) return 'general';
  return `unknown-${target.type}`;
};

export async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class BrowserProfiler {
  private readonly clients = new Map<
    string,
    { target: TargetInfo; client: RawCdp; started: boolean; startAcknowledgedAtMs: number | null }
  >();
  private polling: ReturnType<typeof setInterval> | undefined;
  private pollInFlight: Promise<void> = Promise.resolve();
  private sampleWindowStartedAtMs: number | null = null;
  readonly errors: string[] = [];

  constructor(
    private readonly debugPort: string,
    private readonly origin: string,
  ) {}

  private async targets(): Promise<TargetInfo[]> {
    const response = await withTimeout(
      fetch(`http://127.0.0.1:${this.debugPort}/json/list`),
      5_000,
      '读取 CDP target 列表超过 5 秒。',
    );
    if (!response.ok) throw new Error(`CDP target list returned ${response.status}.`);
    return (await response.json()) as TargetInfo[];
  }

  private async startClient(state: {
    target: TargetInfo;
    client: RawCdp;
    started: boolean;
    startAcknowledgedAtMs: number | null;
  }): Promise<void> {
    if (state.started) return;
    await withTimeout(state.client.send('Profiler.start'), 5_000, 'Profiler.start 超过 5 秒。');
    state.started = true;
    state.startAcknowledgedAtMs = performance.now();
  }

  private async poll(startNewClients: boolean): Promise<void> {
    const targets = await this.targets();
    for (const target of targets) {
      if (!['page', 'worker'].includes(target.type) || !target.webSocketDebuggerUrl) continue;
      if (!target.url.startsWith(this.origin) || this.clients.has(target.id)) continue;
      try {
        const client = await RawCdp.connect(target.webSocketDebuggerUrl);
        await withTimeout(client.send('Profiler.enable'), 5_000, 'Profiler.enable 超过 5 秒。');
        await withTimeout(
          client.send('Profiler.setSamplingInterval', { interval: 1_000 }),
          5_000,
          '设置 Profiler 采样间隔超过 5 秒。',
        );
        const state = { target, client, started: false, startAcknowledgedAtMs: null };
        this.clients.set(target.id, state);
        if (startNewClients) await this.startClient(state);
      } catch (error) {
        this.errors.push(`${target.type}:${target.url}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async start(): Promise<void> {
    // Target discovery and Profiler.enable happen before the measured window.
    // Start commands are then issued together so every isolate observes the
    // same natural-input interval within the registered tolerance.
    await this.poll(false);
    const clientStates = [...this.clients.values()];
    const starts = await Promise.allSettled(clientStates.map((state) => this.startClient(state)));
    starts.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      const state = clientStates[index]!;
      this.errors.push(
        `${targetRole(state.target)}:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    });
    if (starts.some((result) => result.status === 'rejected'))
      throw new Error('至少一个 CDP target 无法开始 CPU profile。');
    this.sampleWindowStartedAtMs = performance.now();
    this.polling = setInterval(() => {
      this.pollInFlight = this.pollInFlight
        .then(() => this.poll(true))
        .catch((error) => {
          this.errors.push(error instanceof Error ? error.message : String(error));
        });
    }, 100);
  }

  async stop(): Promise<ProfileCapture[]> {
    if (this.polling) clearInterval(this.polling);
    await this.pollInFlight;
    await this.poll(true).catch((error) => this.errors.push(error instanceof Error ? error.message : String(error)));
    const stopRequestedAtMs = performance.now();
    const expectedWindowMs = Math.max(0, stopRequestedAtMs - (this.sampleWindowStartedAtMs ?? stopRequestedAtMs));
    const captures = await Promise.all(
      [...this.clients.values()].map(async ({ target, client, started }): Promise<ProfileCapture | null> => {
        if (!started) {
          client.close();
          return null;
        }
        try {
          const [{ profile }, heapUsage] = await Promise.all([
            withTimeout(client.send<{ profile: CpuProfile }>('Profiler.stop'), 10_000, 'Profiler.stop 超过 10 秒。'),
            withTimeout(client.send<HeapUsage>('Runtime.getHeapUsage'), 5_000, '读取 Heap 超过 5 秒。').catch(
              () => 'UNSUPPORTED' as const,
            ),
          ]);
          const profileDurationMs = (profile.endTime - profile.startTime) / 1_000;
          return {
            target: { id: target.id, type: target.type, title: target.title, url: target.url },
            role: targetRole(target),
            profile,
            heapUsage,
            profileDurationMs,
            expectedWindowMs,
            durationDeltaMs: profileDurationMs - expectedWindowMs,
          };
        } catch (error) {
          this.errors.push(`${targetRole(target)}:${error instanceof Error ? error.message : String(error)}`);
          return null;
        } finally {
          client.close();
        }
      }),
    );
    const complete = captures.filter((capture): capture is ProfileCapture => capture !== null);
    for (const capture of complete) {
      if (!Number.isFinite(capture.profileDurationMs) || capture.profileDurationMs <= 0)
        this.errors.push(`${capture.role}:CDP profile duration 无效：${capture.profileDurationMs}ms。`);
      else if (Math.abs(capture.durationDeltaMs) > PROFILE_DURATION_TOLERANCE_MS)
        this.errors.push(
          `${capture.role}:CDP profile ${capture.profileDurationMs.toFixed(3)}ms 与共同窗口 ${expectedWindowMs.toFixed(3)}ms 偏差 ${capture.durationDeltaMs.toFixed(3)}ms，超过 ${PROFILE_DURATION_TOLERANCE_MS}ms。`,
        );
    }
    if (complete.length > 1) {
      const durations = complete.map((capture) => capture.profileDurationMs);
      const spread = Math.max(...durations) - Math.min(...durations);
      if (spread > PROFILE_DURATION_SPREAD_TOLERANCE_MS)
        this.errors.push(
          `CDP target profile duration spread ${spread.toFixed(3)}ms 超过 ${PROFILE_DURATION_SPREAD_TOLERANCE_MS}ms。`,
        );
    }
    return complete;
  }
}

const waitForDebugPort = async (profileDirectory: string): Promise<string> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const port = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).split('\n')[0] ?? '';
      if (/^\d+$/.test(port)) return port;
    } catch {
      // Chrome 尚未写出状态文件，继续有界轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Chrome 在 15 秒内没有进入 CDP 可连接状态。');
};

export async function launchAdoptionChrome(): Promise<{
  browser: Browser;
  debugPort: string;
  close: () => Promise<void>;
}> {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'seedlands-adoption-chrome-'));
  const browserProcess = spawn(
    process.env.SEEDLANDS_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      `--user-data-dir=${profileDirectory}`,
      '--headless=new',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let browser: Browser | undefined;
  const close = async () => {
    if (browser?.isConnected()) {
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close').catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
    if (browserProcess.exitCode === null) browserProcess.kill('SIGTERM');
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    const debugPort = await waitForDebugPort(profileDirectory);
    browser = await withTimeout(
      chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true }),
      10_000,
      'Playwright 连接 Chrome CDP 超过 10 秒。',
    );
    return { browser, debugPort, close };
  } catch (error) {
    await close();
    throw error;
  }
}
