import { Sprite } from './pixel-sprite';

export function spriteLine(sprite: Sprite, x0: number, y0: number, x1: number, y1: number, color: number) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step++) {
    const ratio = steps === 0 ? 0 : step / steps;
    sprite.put(Math.round(x0 + (x1 - x0) * ratio), Math.round(y0 + (y1 - y0) * ratio), color);
  }
}
