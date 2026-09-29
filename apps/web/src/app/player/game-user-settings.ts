import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { BrowserGameplay } from '../gameplay/browser-gameplay';
import { executeBrowserDifficulty } from '../gameplay/browser-gameplay-actions';
import { validateMouseSensitivity } from './mouse-sensitivity';

export const setGameMouseSensitivity = (settings: { value: number }, value: number) =>
  void (settings.value = validateMouseSensitivity(value));

export const setGameDifficulty = (
  authority: BrowserAuthorityClient | null,
  gameplay: BrowserGameplay | null,
  value: import('@seedlands/stdlib/server/gameplay/difficulty-runtime').Difficulty,
  queueSave: () => void,
) => {
  if (!authority || !gameplay) return Promise.reject(new Error('世界尚未开始。'));
  return executeBrowserDifficulty(authority, value, () => {
    gameplay.refresh();
    queueSave();
  });
};

export const gameDifficulty = (authority: BrowserAuthorityClient | null) => authority?.gameplay.difficulty ?? null;
