import type * as pc from 'playcanvas';
import type { AuthorityReady } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { CommandSource } from '@seedlands/game-core/server/commands/command-contract';
import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { GlobalAudio } from '../audio/global-audio';
import { WorldAudio } from '../audio/world-audio';
import type { AuthorityPresentationSync } from '../authority-presentation-sync';
import type { BrowserGameplay } from '../gameplay/browser-gameplay';
import { PLAYER_FEET_OFFSET, type PlayerController } from '../player/player-controller';
import type { WorldEnvironment } from '../scene/world-environment';
import type { World } from './world-runtime';

type RestoreBindings = Readonly<{
  authority: BrowserAuthorityClient;
  world: World;
  camera: pc.Entity;
  environment: WorldEnvironment;
  audio?: GlobalAudio;
  controller: PlayerController | null;
  gameplay: BrowserGameplay | null;
  worldAudio: WorldAudio | null;
  authoritySync: AuthorityPresentationSync;
  commandSource: CommandSource | null;
  createGameplay: (playerId: string) => BrowserGameplay;
  createController: () => PlayerController;
}>;

export function restoreBrowserPresentation(ready: AuthorityReady, bindings: RestoreBindings) {
  bindings.controller?.dispose(false);
  bindings.gameplay?.dispose();
  bindings.authoritySync.clear();
  bindings.environment.setTime(ready.worldTime);
  bindings.world.beginScenario('world-restore');
  bindings.worldAudio?.dispose();
  const worldAudio = bindings.audio ? new WorldAudio(bindings.audio, ready.seed) : null;
  const [x, y, z] = ready.playerBodyPosition;
  bindings.camera.setPosition(x, y + PLAYER_FEET_OFFSET, z);
  const gameplayClient = bindings.createGameplay(ready.playerId);
  const controller = bindings.createController();
  controller.applyAuthoritySnapshot(ready.snapshot);
  controller.install();
  const commandSource = bindings.commandSource ? { ...bindings.commandSource, entityId: ready.playerId } : null;
  bindings.world.updateStreaming(bindings.camera.getPosition());
  return { controller, gameplayClient, worldAudio, commandSource };
}
