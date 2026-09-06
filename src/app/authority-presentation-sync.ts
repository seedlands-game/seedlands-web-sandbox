import type { AuthoritySnapshot } from '../server/authority/authority-session';
import type { HarnessSnapshot } from './app-contracts';
import type { PlayerController } from './player/player-controller';
import { PLAYER_FEET_OFFSET } from './player/player-view-offsets';

export class AuthorityPresentationSync {
  private readonly samples: HarnessSnapshot['trajectory'][number][] = [];

  constructor(private readonly controller: () => PlayerController | null) {}

  receive(snapshot: AuthoritySnapshot): void {
    this.controller()?.applyAuthoritySnapshot(snapshot);
    this.samples.push({
      physicsTick: snapshot.physicsTick,
      activeTimeMs: snapshot.activeTimeMs,
      position: [
        snapshot.player.body.position.x,
        snapshot.player.body.position.y + PLAYER_FEET_OFFSET,
        snapshot.player.body.position.z,
      ],
    });
    if (this.samples.length > 256) this.samples.splice(0, this.samples.length - 256);
  }

  snapshot(): HarnessSnapshot['trajectory'] {
    return this.samples.map((sample) => ({ ...sample, position: [...sample.position] }));
  }

  clear(): void {
    this.samples.length = 0;
  }
}
