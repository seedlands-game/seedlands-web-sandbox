import { describe, expect, it } from 'vitest';
import { PLAYER_FEET_OFFSET, PLAYER_HEAD_OFFSET } from '../../../src/app/player/player-view-offsets';
import { bodyConfigFor } from '../../../../../packages/stdlib/src/physics/body-registry';

describe('玩家视角与身体注册表', () => {
  it('脚底到视角的偏移由真实玩家身体高度派生', () => {
    const player = bodyConfigFor('player').localAabb;

    expect(PLAYER_FEET_OFFSET + PLAYER_HEAD_OFFSET).toBeCloseTo(player.max.y - player.min.y);
  });
});
