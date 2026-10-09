import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { PlayerController } from '../player/player-controller';
import { PLAYER_FEET_OFFSET } from '../player/player-view-offsets';

type Point = readonly [number, number, number];
export type HarnessRouteSnapshot = Readonly<{
  player: Point;
  serverPlayerPosition: Point;
  serverPlayerVelocity: Point;
  viewAngles: readonly [number, number];
  onGround: boolean;
  colliding: boolean;
  authority: Readonly<{ physicsTick: number; acknowledgedInputSequence: number }>;
}>;
type Context = Readonly<{
  controller: Pick<PlayerController, 'position' | 'viewAngles' | 'onGround' | 'isColliding'> | null;
  authority: Pick<BrowserAuthorityClient, 'isReady' | 'snapshot'> | null;
}>;
const point = (value: Readonly<{ x: number; y: number; z: number }>, yOffset = 0): Point =>
  Object.freeze([value.x, value.y + yOffset, value.z]);

/** A detached read of the current owners; unavailable owners never become synthetic route evidence. */
export function createHarnessRouteSnapshot({ controller, authority }: Context): HarnessRouteSnapshot | null {
  const snapshot = authority?.snapshot;
  if (!controller || !authority?.isReady || !snapshot) return null;
  const player = point(controller.position);
  const serverPlayerPosition = point(snapshot.player.body.position, PLAYER_FEET_OFFSET);
  const serverPlayerVelocity = point(snapshot.player.body.velocity);
  const viewAngles = Object.freeze([...controller.viewAngles] as [number, number]);
  const physicsTick = snapshot.physicsTick;
  const acknowledgedInputSequence = snapshot.acknowledgedInputSequence;
  if (
    ![...player, ...serverPlayerPosition, ...serverPlayerVelocity, ...viewAngles].every(Number.isFinite) ||
    !Number.isSafeInteger(physicsTick) ||
    physicsTick < 0 ||
    !Number.isSafeInteger(acknowledgedInputSequence) ||
    acknowledgedInputSequence < -1 ||
    typeof controller.onGround !== 'boolean' ||
    typeof controller.isColliding !== 'boolean'
  )
    return null;
  return Object.freeze({
    player,
    serverPlayerPosition,
    serverPlayerVelocity,
    viewAngles,
    onGround: controller.onGround,
    colliding: controller.isColliding,
    authority: Object.freeze({ physicsTick, acknowledgedInputSequence }),
  });
}
