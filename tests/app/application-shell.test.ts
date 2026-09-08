import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveExperimentalClientOptions } from '../../apps/web/src/client/experimental-client-options';
import { ApplicationShell } from '../../apps/web/src/app/application-shell';
import type { GlobalAudio } from '../../apps/web/src/app/audio/global-audio';
import type { Game } from '../../apps/web/src/app/game';
import type { ClientCapabilityState } from '../../apps/web/src/app/client-capability-preflight';
import { createUiBridge } from '../../apps/web/src/app/ui/ui-bridge';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const capability = (overrides: Partial<ClientCapabilityState> = {}): ClientCapabilityState => ({
  workerSupport: 'supported',
  estimatedCores: 8,
  coreEstimateFallback: false,
  requiredWorkerCount: 5,
  lowCoreWarning: false,
  ...overrides,
});

const createGame = () =>
  ({
    onRuntimeFailure: null,
    loadLatestWorldSeed: vi.fn(async () => null),
    loadSavedSession: vi.fn(() => null),
    start: vi.fn(async () => undefined),
    prepareMeleeShowcase: vi.fn(async () => undefined),
    abortStart: vi.fn(),
    leaveWorld: vi.fn(async () => undefined),
    setPaused: vi.fn(),
    releaseInput: vi.fn(),
  }) as unknown as Game;

const createAudio = () => ({ unlock: vi.fn(async () => true) }) as unknown as GlobalAudio;

describe('ApplicationShell experiment and capability gates', () => {
  let storage: MemoryStorage;
  let replaceState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = new MemoryStorage();
    replaceState = vi.fn();
    const windowTarget = new EventTarget();
    const documentTarget = Object.assign(new EventTarget(), {
      hidden: false,
      querySelector: vi.fn(() => null),
    });
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('location', {
      search: '?harness=1&wasm=on',
      href: 'https://seedlands.test/?harness=1&wasm=on',
      reload: vi.fn(),
    });
    vi.stubGlobal('history', { state: null, replaceState });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('保存 pending 配置但冻结当前页面 applied 配置', () => {
    const experiments = resolveExperimentalClientOptions({ search: '', stored: null });
    const application = new ApplicationShell(createGame(), createUiBridge(), createAudio(), { experiments });
    application.setExperiment('wasm', false);

    expect(application.appliedExperiments.options.wasm).toBe(true);
    expect(application.pendingExperiments).toMatchObject({ wasm: false, simd: true });
    expect(application.experimentsRequireRefresh).toBe(true);
    expect(JSON.parse(storage.getItem('seedlands.experiments.v1') ?? '{}')).toMatchObject({ wasm: false, simd: true });
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://seedlands.test/?harness=1');
    application.dispose();
  });

  it('Worker 不支持时硬阻断，低核心数时仅在确认后启动', async () => {
    const blockedGame = createGame();
    const blocked = new ApplicationShell(blockedGame, createUiBridge(), createAudio(), {
      preflight: async () => capability({ workerSupport: 'unsupported', reason: 'probe failed' }),
    });
    await blocked.initialize();
    await expect(blocked.start('blocked', 'medium')).rejects.toThrow(/Web Worker/);
    expect(blockedGame.start).not.toHaveBeenCalled();
    blocked.dispose();

    const warnedGame = createGame();
    const warned = new ApplicationShell(warnedGame, createUiBridge(), createAudio(), {
      preflight: async () => capability({ estimatedCores: 4, lowCoreWarning: true }),
    });
    await warned.initialize();
    await warned.start('warned', 'medium');
    expect(warned.performanceWarningOpen).toBe(true);
    expect(warnedGame.start).not.toHaveBeenCalled();
    await warned.confirmPerformanceWarning();
    expect(warnedGame.start).toHaveBeenCalledOnce();
    warned.dispose();
  });

  it('资源与能力均 ready 后才发布可进入菜单', async () => {
    let releaseResource!: () => void;
    const resourceReady = new Promise<void>((resolve) => {
      releaseResource = resolve;
    });
    const bridge = createUiBridge();
    const application = new ApplicationShell(createGame(), bridge, createAudio(), {
      preflight: async () => capability(),
    });

    const initializing = application.initialize(resourceReady);
    await Promise.resolve();
    expect(bridge.shell.get().phase).toBe('boot');

    releaseResource();
    await initializing;
    expect(bridge.shell.get().phase).toBe('menu');
    application.dispose();
  });

  it('木剑体验场跨过低核心确认后仍以固定新世界启动并完成布置', async () => {
    const game = createGame();
    const application = new ApplicationShell(game, createUiBridge(), createAudio(), {
      preflight: async () => capability({ estimatedCores: 4, lowCoreWarning: true }),
    });
    await application.initialize();

    await application.startMeleeShowcase('high');
    expect(game.start).not.toHaveBeenCalled();
    await application.confirmPerformanceWarning();

    expect(game.start).toHaveBeenCalledWith('wood-sword-action-stage-v1', null, 'high', 'new-current');
    expect(game.prepareMeleeShowcase).toHaveBeenCalledOnce();
    application.dispose();
  });
});
