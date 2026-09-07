import { formatBuildWatermark } from '../client/build-watermark';
import {
  persistExperimentalClientOptions,
  readStoredExperimentalClientOptions,
  resolveExperimentalClientOptions,
  type ExperimentalClientOptions,
} from '../client/experimental-client-options';
import { GENERATOR_VERSION } from '../world/voxel';
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
  fallbackSeed?: string;
  fallbackQuality?: string;
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
  const cleanup: Array<() => void | Promise<void>> = [];
  try {
    const canvas = requiredElement<HTMLCanvasElement>('#game');
    const uiRoot = requiredElement<HTMLElement>('#ui');
    const experiments = resolveExperimentalClientOptions({
      search: location.search,
      stored: readStoredExperimentalClientOptions(localStorage),
      initialization: options.experiments,
    });
    const sessionConfig = readBrowserSessionConfig(location.search);
    const uiBridge = createUiBridge();
    uiBridge.publishShell({
      seed: options.fallbackSeed ?? '',
      quality:
        options.fallbackQuality === 'low' || options.fallbackQuality === 'high' ? options.fallbackQuality : 'medium',
    });
    const audio = new GlobalAudio();
    const removeAudioHarness = installAudioHarness(audio);
    cleanup.push(removeAudioHarness);
    const game = new Game(canvas, uiBridge, audio, experiments);
    cleanup.push(() => game.dispose());
    const application = new ApplicationShell(game, uiBridge, audio, {
      experiments,
      generalWorkerCount: sessionConfig.generalWorkerCount,
    });
    cleanup.push(() => application.dispose());
    const actions: UiActionPort = {
      startWorld: (seed, quality, openMode) => application.start(seed, quality, openMode),
      selectHotbarSlot: (slot) => game.selectHotbarSlot(slot),
      toggleInventory: () => game.toggleInventory(),
      closeInventory: () => game.closeInventory(),
      craftRecipe: (recipeId) => game.craftRecipe(recipeId),
      moveInventorySlot: (source, target) => game.moveInventorySlot(source, target),
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
    const unmount = mountUi(uiRoot, {
      bridge: uiBridge,
      actions,
      application,
      buildWatermark,
      buildCommit: commitSha,
    });
    cleanup.push(unmount);
    await Promise.all([application.initialize(), options.resourceReady]);
    const removePersistenceHarness = await installPersistenceHarness();
    cleanup.push(removePersistenceHarness);
    const onButtonClick = (event: MouseEvent) => {
      if ((event.target as Element)?.closest('button'))
        void audio.unlock().then(() => audio.play('hover', { scope: 'ui' }));
    };
    document.addEventListener('click', onButtonClick);
    cleanup.push(() => document.removeEventListener('click', onButtonClick));
    persistExperimentalClientOptions(localStorage, experiments.options);
    bootstrapState = 'ready';
  } catch (error) {
    for (const dispose of cleanup.reverse()) await dispose();
    bootstrapState = 'idle';
    throw error;
  }
}

declare global {
  interface Window {
    __SEEDLANDS_INITIAL_OPTIONS__?: SeedlandsInitializationOptions;
  }
}
