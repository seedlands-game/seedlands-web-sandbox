import './styles/hud.css';
import './styles/macro-map.css';
import { appElements } from './app-elements';
import { Game } from './game';
import { installPersistenceHarness } from './game-harness';

const game = new Game();
void installPersistenceHarness();
const saved = game.loadSavedSession();

appElements.enterButton.disabled = true;
if (saved) {
  appElements.seedInput.value = saved.seed;
  appElements.enterButton.disabled = false;
} else {
  void game
    .loadLatestWorldSeed()
    .then((seed) => {
      if (seed && !appElements.seedInput.value) appElements.seedInput.value = seed;
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
