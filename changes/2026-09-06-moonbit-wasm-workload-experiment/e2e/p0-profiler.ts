import { chromium, expect, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type CpuProfile = {
  startTime: number;
  endTime: number;
  nodes: Array<{
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
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

export type ProfileCapture = {
  target: Omit<TargetInfo, 'webSocketDebuggerUrl'>;
  role: string;
  profile: CpuProfile;
  heapUsage: unknown;
};

type SourceMap = {
  sources: string[];
  names: string[];
  mappings: string;
};

type MappingSegment = {
  generatedColumn: number;
  source: string;
  originalLine: number;
  originalColumn: number;
  name?: string;
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export class RawCdp {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
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
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`无法连接 CDP target：${url}`)), { once: true });
    });
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

function targetRole(target: TargetInfo): string {
  if (target.type === 'page') return 'main';
  if (target.url.includes('authority-worker')) return 'authority';
  if (target.url.includes('game-logic-worker')) return 'logic';
  if (target.url.includes('fluid-compute-worker')) return 'fluid';
  if (target.url.includes('persistence-worker')) return 'persistence';
  if (target.url.includes('world-worker')) return 'general';
  return `unknown-${target.type}`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
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
  private readonly clients = new Map<string, { target: TargetInfo; client: RawCdp }>();
  private polling: ReturnType<typeof setInterval> | undefined;
  private pollInFlight: Promise<void> = Promise.resolve();
  readonly errors: string[] = [];

  constructor(
    private readonly debugPort: string,
    private readonly origin: string,
  ) {}

  private async targets(): Promise<TargetInfo[]> {
    const response = await fetch(`http://127.0.0.1:${this.debugPort}/json/list`);
    if (!response.ok) throw new Error(`CDP target list returned ${response.status}.`);
    return (await response.json()) as TargetInfo[];
  }

  private async poll(): Promise<void> {
    const targets = await this.targets();
    for (const target of targets) {
      if (!['page', 'worker'].includes(target.type) || !target.webSocketDebuggerUrl) continue;
      if (!target.url.startsWith(this.origin)) continue;
      if (this.clients.has(target.id)) continue;
      try {
        const client = await RawCdp.connect(target.webSocketDebuggerUrl);
        await client.send('Profiler.enable');
        await client.send('Profiler.setSamplingInterval', { interval: 1_000 });
        await client.send('Profiler.start');
        this.clients.set(target.id, { target, client });
      } catch (error) {
        this.errors.push(`${target.type}:${target.url}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async start(): Promise<void> {
    await this.poll();
    this.polling = setInterval(() => {
      this.pollInFlight = this.pollInFlight
        .then(() => this.poll())
        .catch((error) => {
          this.errors.push(error instanceof Error ? error.message : String(error));
        });
    }, 100);
  }

  async stop(): Promise<ProfileCapture[]> {
    if (this.polling) clearInterval(this.polling);
    await this.pollInFlight;
    await this.poll().catch((error) => this.errors.push(error instanceof Error ? error.message : String(error)));
    const captures: ProfileCapture[] = [];
    for (const { target, client } of this.clients.values()) {
      try {
        const [{ profile }, heapUsage] = await Promise.all([
          withTimeout(
            client.send<{ profile: CpuProfile }>('Profiler.stop'),
            10_000,
            'Profiler.stop 超过 10 秒未返回。',
          ),
          client.send('Runtime.getHeapUsage').catch(() => 'UNSUPPORTED'),
        ]);
        captures.push({
          target: { id: target.id, type: target.type, title: target.title, url: target.url },
          role: targetRole(target),
          profile,
          heapUsage,
        });
      } catch (error) {
        this.errors.push(`${targetRole(target)}:${error instanceof Error ? error.message : String(error)}`);
      } finally {
        client.close();
      }
    }
    return captures;
  }
}

export async function launchP0Chrome(): Promise<{
  browser: Browser;
  debugPort: string;
  close: () => Promise<void>;
}> {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'seedlands-moonbit-p0-chrome-'));
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
    let debugPort = '';
    await expect
      .poll(async () => {
        try {
          debugPort = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).split('\n')[0] ?? '';
        } catch {
          debugPort = '';
        }
        return debugPort;
      })
      .toMatch(/^\d+$/);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true });
    return { browser, debugPort, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) throw new Error(`非法 source map VLQ 字符：${character}`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    values.push((negative ? -1 : 1) * (value >> 1));
    value = 0;
    shift = 0;
  }
  return values;
}

function parseMappings(map: SourceMap): MappingSegment[][] {
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  return map.mappings.split(';').map((line) => {
    let generatedColumn = 0;
    const entries: MappingSegment[] = [];
    for (const raw of line.split(',')) {
      if (!raw) continue;
      const values = decodeVlq(raw);
      generatedColumn += values[0] ?? 0;
      if (values.length < 4) continue;
      sourceIndex += values[1] ?? 0;
      originalLine += values[2] ?? 0;
      originalColumn += values[3] ?? 0;
      if (values.length >= 5) nameIndex += values[4] ?? 0;
      entries.push({
        generatedColumn,
        source: map.sources[sourceIndex] ?? 'UNKNOWN',
        originalLine,
        originalColumn,
        ...(values.length >= 5 ? { name: map.names[nameIndex] } : {}),
      });
    }
    return entries;
  });
}

function findMapping(lines: MappingSegment[][], line: number, column: number): MappingSegment | undefined {
  const segments = lines[line];
  if (!segments?.length) return undefined;
  let low = 0;
  let high = segments.length - 1;
  let found: MappingSegment | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = segments[middle]!;
    if (candidate.generatedColumn <= column) {
      found = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

function responsibility(
  source: string,
  name: string,
  role: string,
  scenario: string,
  line: number,
): `W${string}` | 'ENGINE_JS' | 'NATIVE_RUNTIME' | 'UNATTRIBUTED' | 'IDLE' {
  const path = source.replaceAll('\\', '/');
  if ((!path || path === 'UNKNOWN') && name === '(idle)') return 'IDLE';
  if (!path || path === 'UNKNOWN') return 'NATIVE_RUNTIME';
  if (path.includes('/playcanvas/')) return 'ENGINE_JS';
  if (path.includes('/svelte/')) return 'W28';
  if (path.includes('/tone/')) return 'W29';
  if (!path.includes('/src/')) return name.startsWith('(') ? 'NATIVE_RUNTIME' : 'UNATTRIBUTED';
  if (/macro-map-renderer/.test(path) || (scenario === 'map' && /macro-world/.test(path))) return 'W16';
  if (/macro-world/.test(path)) return 'W01';
  if (/chunk-generation/.test(path) || (/world\/voxel\.ts/.test(path) && /baseVoxel/i.test(name))) return 'W02';
  if (/mesh-mask/.test(path)) return 'W04';
  if (/water-mesh-height|voxel-model-mesh/.test(path)) return 'W05';
  if (/world\/mesh\.ts/.test(path) && line >= 411) return 'W06';
  if (/world\/mesh\.ts/.test(path) && line >= 172) return 'W04';
  if (/world\/mesh\.ts/.test(path)) return 'W03';
  if (/fluid-transaction/.test(path)) return 'W07';
  if (/physics\/(step-body|geometry|recovery|reachability)/.test(path)) return role === 'main' ? 'W21' : 'W08';
  if (/authority-session/.test(path) && /snapshot/i.test(name)) return 'W18';
  if (/authority-session/.test(path) && /stepPhysics|pair|separate|pickup/i.test(name)) return 'W09';
  if (/logic-observation-builder/.test(path)) return 'W10';
  if (/logic-terrain/.test(path)) return 'W11';
  if (/entity-store|perception-runtime|poi-registry/.test(path)) return 'W12';
  if (/logic-decision|action-runtime|server\/gameplay/.test(path)) return 'W13';
  if (/chunk-snapshot-codec/.test(path) && (line <= 66 || /crc|checksum/i.test(name))) return 'W15';
  if (/chunk-snapshot-codec/.test(path)) return 'W14';
  if (/safe-spawn|starter-surface|starter-ecology/.test(path)) return 'W17';
  if (/snapshot|projection|collision-mirror|server-mesh-snapshots|authority-transport/.test(path)) return 'W18';
  if (/world-(mutation|transaction-commit)|fill-command/.test(path)) return 'W19';
  if (/world-runtime|compute-task-queue|compute-worker-pool|chunk-residency/.test(path)) return 'W20';
  if (/local-player-prediction|prediction-buffer/.test(path)) return 'W21';
  if (/voxel-target|entity-hit-volume|voxel-ray/.test(path)) return 'W22';
  if (/snapshot-interpolator|entity-presentation|first-person-viewmodel|voxel-break-overlay/.test(path)) return 'W23';
  if (/advanced-visual-effects|water-reflection-plane|world-environment|water-experience/.test(path)) return 'W24';
  if (/voxel-render-pipeline|stylized-post-effect|shaders/.test(path)) return 'W25';
  if (/playcanvas-chunk-adapter|mesh-visibility-barriers/.test(path)) return 'W26';
  if (/persistence|indexed-db|indexeddb/.test(path)) return 'W27';
  if (/audio/.test(path)) return 'W29';
  if (/headless|autonomy-runtime|ground-navigator|world\/voxel\.ts/.test(path)) return 'W30';
  if (/server\/authority|loaded-voxel-reader|voxel-collision-world/.test(path)) return 'W08';
  if (/app\/|client\/|ui\/|commands\/|runtime\/|worker\//.test(path)) return 'W28';
  if (/server\//.test(path)) return 'W13';
  if (/world\//.test(path)) return 'W30';
  return 'UNATTRIBUTED';
}

export async function analyseProfiles(origin: string, scenario: string, captures: ProfileCapture[]): Promise<object> {
  const maps = new Map<string, MappingSegment[][] | null>();
  const buckets = new Map<string, number>();
  const roles = new Map<string, number>();
  const activeRoles = new Map<string, number>();
  const hotspots: Array<{
    role: string;
    milliseconds: number;
    responsibility: string;
    source: string;
    line: number;
    name: string;
  }> = [];
  let sampledWallMicroseconds = 0;
  let sampledActiveMicroseconds = 0;
  for (const capture of captures) {
    const nodes = new Map(capture.profile.nodes.map((node) => [node.id, node]));
    for (let index = 0; index < (capture.profile.samples?.length ?? 0); index += 1) {
      const node = nodes.get(capture.profile.samples![index]!);
      if (!node) continue;
      const microseconds = capture.profile.timeDeltas?.[index] ?? 0;
      sampledWallMicroseconds += microseconds;
      roles.set(capture.role, (roles.get(capture.role) ?? 0) + microseconds);
      const frame = node.callFrame;
      let source = frame.url;
      let line = frame.lineNumber;
      let mappedName = frame.functionName;
      if (frame.url.startsWith(origin) && frame.url.endsWith('.js')) {
        let mappings = maps.get(frame.url);
        if (mappings === undefined) {
          const response = await fetch(`${frame.url}.map`);
          mappings = response.ok ? parseMappings((await response.json()) as SourceMap) : null;
          maps.set(frame.url, mappings);
        }
        const mapped = mappings ? findMapping(mappings, frame.lineNumber, frame.columnNumber) : undefined;
        if (mapped) {
          source = mapped.source;
          line = mapped.originalLine;
          mappedName = mapped.name ?? mappedName;
        }
      }
      const bucket = responsibility(source, mappedName, capture.role, scenario, line + 1);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + microseconds);
      if (bucket !== 'IDLE') {
        sampledActiveMicroseconds += microseconds;
        activeRoles.set(capture.role, (activeRoles.get(capture.role) ?? 0) + microseconds);
      }
      hotspots.push({
        role: capture.role,
        milliseconds: microseconds / 1_000,
        responsibility: bucket,
        source,
        line: line + 1,
        name: mappedName,
      });
    }
  }
  const totalMs = sampledActiveMicroseconds / 1_000;
  const aggregate = (entries: typeof hotspots) => {
    const byKey = new Map<string, (typeof hotspots)[number]>();
    for (const entry of entries) {
      const key = `${entry.role}|${entry.responsibility}|${entry.source}|${entry.line}|${entry.name}`;
      const current = byKey.get(key);
      if (current) current.milliseconds += entry.milliseconds;
      else byKey.set(key, { ...entry });
    }
    return [...byKey.values()].sort((left, right) => right.milliseconds - left.milliseconds).slice(0, 40);
  };
  return {
    samplingIntervalMicroseconds: 1_000,
    sampledWallAcrossTargetsMs: sampledWallMicroseconds / 1_000,
    sampledActiveCpuMs: totalMs,
    idleMs: (buckets.get('IDLE') ?? 0) / 1_000,
    roles: Object.fromEntries(
      [...roles.entries()].map(([role, microseconds]) => [
        role,
        {
          profileWallMs: microseconds / 1_000,
          activeCpuMs: (activeRoles.get(role) ?? 0) / 1_000,
        },
      ]),
    ),
    responsibilities: Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => `W${String(index + 1).padStart(2, '0')}`).map((id) => [
        id,
        {
          cpuMs: (buckets.get(id) ?? 0) / 1_000,
          sharePercent: totalMs > 0 ? ((buckets.get(id) ?? 0) / 1_000 / totalMs) * 100 : 0,
          status: buckets.has(id) ? 'SAMPLED' : 'BELOW_SAMPLING_RESOLUTION',
        },
      ]),
    ),
    separate: {
      engineJsCpuMs: (buckets.get('ENGINE_JS') ?? 0) / 1_000,
      nativeRuntimeCpuMs: (buckets.get('NATIVE_RUNTIME') ?? 0) / 1_000,
      gpuDuration: 'NOT_COLLECTED',
      unattributedCpuMs: (buckets.get('UNATTRIBUTED') ?? 0) / 1_000,
      unattributedPercent: totalMs > 0 ? ((buckets.get('UNATTRIBUTED') ?? 0) / 1_000 / totalMs) * 100 : 0,
    },
    hotspots: aggregate(hotspots.filter((entry) => entry.responsibility !== 'IDLE')),
  };
}
