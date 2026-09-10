import { formatBuildWatermark } from '../client/build-watermark';
import {
  persistExperimentalClientOptions,
  readStoredExperimentalClientOptions,
  resolveExperimentalClientOptions,
  type ExperimentalClientOptions,
} from '../client/experimental-client-options';
import { GENERATOR_VERSION } from '@seedlands/game-core/world/voxel';
import { ApplicationShell } from './application-shell';
import { GlobalAudio } from './audio/global-audio';
import { installAudioHarness } from './audio/audio-harness';
import { readBrowserSessionConfig } from './browser-session-config';
import { Game } from './game';
import { installPersistenceHarness } from './game-harness';
import { createUiBridge } from './ui/ui-bridge';
import type { UiActionPort } from './ui/ui-contracts';
import { mountUi } from './ui/mount-ui';
import './ui/styles/shell.css';
import './ui/styles/theme.css';
import './ui/styles/presentation.css';
import './ui/styles/survival.css';
import './ui/styles/experience.css';

export type SeedlandsInitializationOptions = Readonly<{
  experiments?: Partial<ExperimentalClientOptions>;
  resourceReady?: Promise<unknown>;
}>;

type BootstrapState = 'idle' | 'starting' | 'ready';
let bootstrapState: BootstrapState = 'idle';

const requiredElement = <ElementType extends Element>(selector: string) => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`缺少应用元素：${selector}`);
  return element;
};

export async function initializeSeedlands(options: SeedlandsInitializationOptions = {}): Promise<void> {
  if (bootstrapState !== 'idle') throw new Error(`Seedlands initialization is already ${bootstrapState}.`);
  bootstrapState = 'starting';
  let publishInitializationFailure: (() => void) | null = null;
  try {
    const canvas = requiredElement<HTMLCanvasElement>('#game');
    const uiRoot = requiredElement<HTMLElement>('#ui');
    const prerenderedSeed = uiRoot.querySelector<HTMLInputElement>('#seed');
    const prerenderedQuality = uiRoot.querySelector<HTMLSelectElement>('#quality');
    const experiments = resolveExperimentalClientOptions({
      search: location.search,
      stored: readStoredExperimentalClientOptions(localStorage),
      initialization: options.experiments,
    });
    const sessionConfig = readBrowserSessionConfig(location.search);
    const uiBridge = createUiBridge();
    const seed = prerenderedSeed?.value.trim() ?? '';
    const quality = prerenderedQuality?.value;
    uiBridge.publishShell({
      seed,
      quality: quality === 'low' || quality === 'high' ? quality : 'medium',
    });
    publishInitializationFailure = () =>
      uiBridge.publishShell({
        phase: 'error',
        enterLabel: '重新加载游戏资源',
        initializationError: '游戏资源加载失败，请检查网络后重试。',
      });
    const audio = new GlobalAudio();
    installAudioHarness(audio);
    const game = new Game(canvas, uiBridge, audio, experiments);
    const application = new ApplicationShell(game, uiBridge, audio, {
      experiments,
      generalWorkerCount: sessionConfig.generalWorkerCount,
    });
    const actions: UiActionPort = {
      companion: game.companion,
      startWorld: (seed, quality, openMode, actorMode) => application.start(seed, quality, openMode, actorMode),
      startMeleeShowcase: (quality) => application.startMeleeShowcase(quality),
      resetMeleeShowcase: () => game.prepareMeleeShowcase().catch(() => undefined),
      triggerMeleeShowcaseDamage: () => game.triggerMeleeShowcaseDamage(),
      selectHotbarSlot: (slot) => game.selectHotbarSlot(slot),
      setActorMode: async (mode) => {
        await game.setModeControl({ type: 'set-mode', mode });
      },
      setFlight: (enabled) => game.setModeControl({ type: 'set-flight', enabled }),
      setCreativeSlot: (slot, itemId) => game.setModeControl({ type: 'set-creative-slot', slot, itemId }),
      toggleInventory: () => game.toggleInventory(),
      closeInventory: () => game.closeInventory(),
      inventoryPointer: (command) => game.inventoryPointer(command),
      craftRecipe: (recipeId) => game.craftRecipe(recipeId),
      useInventoryItem: (slot) => game.useInventoryItem(slot),
      respawn: () => game.respawn(),
      toggleMap: () => game.toggleMap(),
      toggleCollisionDebug: () => game.toggleCollisionDebug(),
      setCollisionDebugContacts: (enabled) => game.setCollisionDebugContacts(enabled),
      setCollisionDebugSensors: (enabled) => game.setCollisionDebugSensors(enabled),
      closeMap: () => game.closeMap(),
      setMapLayer: (layer) => game.setMapLayer(layer),
      closeCommandShell: () => game.closeCommandShell(),
      executeCommand: (input) => game.executeCommand(input),
      releaseInput: () => game.releaseInput(),
    };
    const commitSha = import.meta.env.VITE_COMMIT_SHA?.trim();
    const buildWatermark = commitSha ? (formatBuildWatermark(commitSha, GENERATOR_VERSION) ?? '') : '';
    mountUi(uiRoot, {
      bridge: uiBridge,
      actions,
      application,
      buildWatermark,
      buildCommit: commitSha,
    });
    await application.initialize(options.resourceReady ?? Promise.resolve());
    await installPersistenceHarness();
    const onButtonClick = (event: MouseEvent) => {
      if ((event.target as Element)?.closest('button'))
        void audio.unlock().then(() => audio.play('hover', { scope: 'ui' }));
    };
    document.addEventListener('click', onButtonClick);
    persistExperimentalClientOptions(localStorage, experiments.options);
    bootstrapState = 'ready';
  } catch (error) {
    publishInitializationFailure?.();
    bootstrapState = 'ready';
    throw error;
  }
}

declare global {
  interface Window {
    __SEEDLANDS_INITIAL_OPTIONS__?: SeedlandsInitializationOptions;
  }
}
