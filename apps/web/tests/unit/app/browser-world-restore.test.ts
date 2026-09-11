import type * as pc from 'playcanvas';
import type { AuthorityReady } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { expect, it, vi } from 'vitest';
import type { AuthorityPresentationSync } from '../../../src/app/authority-presentation-sync';
import type { BrowserGameplay } from '../../../src/app/gameplay/browser-gameplay';
import type { PlayerController } from '../../../src/app/player/player-controller';
import type { WorldEnvironment } from '../../../src/app/scene/world-environment';
import { restoreBrowserPresentation } from '../../../src/app/world/browser-world-restore';
import type { World } from '../../../src/app/world/world-runtime';
import type { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';

it('publishes the replacement gameplay projection before a restored checkpoint returns', () => {
  const previousGameplay = { dispose: vi.fn() } as unknown as BrowserGameplay;
  const nextGameplay = { refresh: vi.fn() } as unknown as BrowserGameplay;
  const previousController = { dispose: vi.fn() } as unknown as PlayerController;
  const nextController = {
    applyAuthoritySnapshot: vi.fn(),
    install: vi.fn(),
  } as unknown as PlayerController;
  const position = { x: 0, y: 0, z: 0 };
  const camera = {
    setPosition: vi.fn(),
    getPosition: vi.fn(() => position),
  } as unknown as pc.Entity;
  const ready = {
    worldTime: 9,
    seed: 7,
    playerId: 'restored-player',
    playerBodyPosition: [1, 2, 3],
    snapshot: { epoch: 'restored-epoch' },
  } as unknown as AuthorityReady;

  const restored = restoreBrowserPresentation(ready, {
    authority: {} as BrowserAuthorityClient,
    world: {
      beginScenario: vi.fn(),
      updateStreaming: vi.fn(),
    } as unknown as World,
    camera,
    environment: { setTime: vi.fn() } as unknown as WorldEnvironment,
    controller: previousController,
    gameplay: previousGameplay,
    worldAudio: null,
    authoritySync: { clear: vi.fn() } as unknown as AuthorityPresentationSync,
    commandSource: null,
    createGameplay: () => nextGameplay,
    createController: () => nextController,
  });

  expect(restored.gameplayClient).toBe(nextGameplay);
  expect(nextGameplay.refresh).toHaveBeenCalledOnce();
});
