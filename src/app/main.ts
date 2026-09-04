import { formatBuildWatermark } from '../client/build-watermark';
import { BrowserChunkPersistence } from '../client/browser-chunk-persistence';
import { GENERATOR_VERSION } from '../world/voxel';
import './styles/hud.css';
import './styles/macro-map.css';
import { appElements } from './app-elements';
import { BrowserWorldStore } from './browser-world-store';
import { installPersistenceHarness } from './game-harness';
import type { Game } from './game';

const commitSha = import.meta.env.VITE_COMMIT_SHA?.trim();
const buildWatermark = formatBuildWatermark(commitSha, GENERATOR_VERSION);
if (buildWatermark && commitSha) {
  const watermark = document.createElement('div');
  watermark.id = 'build-watermark';
  watermark.dataset.commit = commitSha;
  watermark.textContent = buildWatermark;
  watermark.title = `Seedlands Web Sandbox build ${commitSha}`;
  watermark.setAttribute('aria-label', `Build ${buildWatermark}`);
  document.querySelector<HTMLElement>('#ui')!.append(watermark);
}

void installPersistenceHarness();
const saved = new BrowserWorldStore().load();
let gamePromise: Promise<Game> | null = null;

const loadGame = () => {
  gamePromise ??= import('./game')
    .then(({ Game }) => new Game())
    .catch((error: unknown) => {
      gamePromise = null;
      throw error;
    });
  return gamePromise;
};

appElements.enterButton.disabled = true;
if (saved) {
  appElements.seedInput.value = saved.seed;
  appElements.enterButton.disabled = false;
} else {
  void BrowserChunkPersistence.latestWorld()
    .then((seed) => {
      if (seed?.seedText && !appElements.seedInput.value) appElements.seedInput.value = seed.seedText;
    })
    .finally(() => {
      appElements.enterButton.disabled = false;
    });
}

appElements.enterButton.onclick = async () => {
  const seed = appElements.seedInput.value.trim() || `world-${Math.random().toString(36).slice(2, 10)}`;
  const restore = saved?.seed === seed ? saved : null;
  appElements.enterButton.disabled = true;
  appElements.enterButton.textContent = '正在唤醒世界…';
  try {
    const game = await loadGame();
    await game.start(seed, restore);
  } catch (error) {
    appElements.startCard.hidden = false;
    appElements.hud.hidden = true;
    appElements.enterButton.disabled = false;
    appElements.enterButton.textContent = '重试进入';
    throw error;
  }
  appElements.startCard.hidden = true;
  appElements.hud.hidden = false;
  appElements.enterButton.disabled = false;
  appElements.enterButton.textContent = '进入世界';
};
