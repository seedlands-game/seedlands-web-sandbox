import { bodyConfigFor } from '@seedlands/game-core/physics/body-registry';

const PLAYER_BODY_HEIGHT = bodyConfigFor('player').localAabb.max.y - bodyConfigFor('player').localAabb.min.y;
export const PLAYER_HEAD_OFFSET = 0.2;
export const PLAYER_FEET_OFFSET = PLAYER_BODY_HEIGHT - PLAYER_HEAD_OFFSET;
