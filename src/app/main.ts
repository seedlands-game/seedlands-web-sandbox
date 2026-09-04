import { formatBuildWatermark } from '../client/build-watermark';
import { GENERATOR_VERSION } from '../world/voxel';
import { Game } from './game';
import { installPersistenceHarness } from './game-harness';
import './ui/styles/theme.css';
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
const game = new Game(canvas, uiBridge);
const saved = game.loadSavedSession();

const actions: UiActionPort = {
  async startWorld(seedInput, quality) {
    const seed = seedInput.trim() || `world-${Math.random().toString(36).slice(2, 10)}`;
    const restore = saved?.seed === seed ? saved : null;
    uiBridge.publishShell({ phase: 'loading', seed, quality, enterLabel: '正在唤醒世界…' });
    try {
      await game.start(seed, restore, quality);
    } catch (error) {
      uiBridge.publishShell({ phase: 'error', enterLabel: '重试进入' });
      console.error('Seedlands world start failed.', error);
    }
  },
  selectMaterial: (material) => game.selectMaterial(material),
  toggleMap: () => game.toggleMap(),
  closeMap: () => game.closeMap(),
  setMapLayer: (layer) => game.setMapLayer(layer),
  closeCommandShell: () => game.closeCommandShell(),
  executeCommand: (input) => game.executeCommand(input),
  releaseInput: () => game.releaseInput(),
};

const commitSha = import.meta.env.VITE_COMMIT_SHA?.trim();
const buildWatermark = commitSha ? (formatBuildWatermark(commitSha, GENERATOR_VERSION) ?? '') : '';
mountUi(uiRoot, { bridge: uiBridge, actions, buildWatermark, buildCommit: commitSha });
void installPersistenceHarness();

if (saved) uiBridge.publishShell({ phase: 'menu', seed: saved.seed, enterLabel: '进入世界' });
else
  void game
    .loadLatestWorldSeed()
    .then((seed) => {
      uiBridge.publishShell({ phase: 'menu', seed: seed ?? '', enterLabel: '进入世界' });
    })
    .catch(() => {
      uiBridge.publishShell({ phase: 'menu', enterLabel: '进入世界' });
    });
