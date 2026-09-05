import { formatBuildWatermark } from '../client/build-watermark';
import { GENERATOR_VERSION } from '../world/voxel';
import { Game } from './game';
import { GlobalAudio } from './audio/global-audio';
import { installAudioHarness } from './audio/audio-harness';
import { ApplicationShell } from './application-shell';
import './ui/styles/shell.css';
import { installPersistenceHarness } from './game-harness';
import './ui/styles/theme.css';
import './ui/styles/presentation.css';
import './ui/styles/survival.css';
import './ui/styles/experience.css';
import { createUiBridge } from './ui/ui-bridge';
import type { UiActionPort } from './ui/ui-contracts';
import { mountUi } from './ui/mount-ui';

const requiredElement = <ElementType extends Element>(selector: string) => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`缺少应用元素：${selector}`);
  return element;
};

const canvas = requiredElement<HTMLCanvasElement>('#game');
const uiRoot = requiredElement<HTMLElement>('#ui');
const uiBridge = createUiBridge();
const audio = new GlobalAudio();
installAudioHarness(audio);
const game = new Game(canvas, uiBridge, audio);
const application = new ApplicationShell(game, uiBridge, audio);

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
  closeMap: () => game.closeMap(),
  setMapLayer: (layer) => game.setMapLayer(layer),
  closeCommandShell: () => game.closeCommandShell(),
  executeCommand: (input) => game.executeCommand(input),
  releaseInput: () => game.releaseInput(),
};

const commitSha = import.meta.env.VITE_COMMIT_SHA?.trim();
const buildWatermark = commitSha ? (formatBuildWatermark(commitSha, GENERATOR_VERSION) ?? '') : '';
mountUi(uiRoot, { bridge: uiBridge, actions, application, buildWatermark, buildCommit: commitSha });
void installPersistenceHarness();

void application.initialize();

document.addEventListener('click', (event) => {
  if ((event.target as Element)?.closest('button'))
    void audio.unlock().then(() => audio.play('hover', { scope: 'ui' }));
});
