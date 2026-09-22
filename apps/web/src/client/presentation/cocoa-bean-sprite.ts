import { Sprite } from './pixel-sprite';

/** Three offset beans make the inventory icon read as a resource, rather than a generic brown orb. */
export function cocoaBeanSprite(): number[] {
  const sprite = new Sprite();
  for (const [x, y] of [
    [10, 12],
    [17, 9],
    [17, 17],
  ]) {
    sprite.polygon(
      [
        [x, y + 3],
        [x + 4, y],
        [x + 8, y + 3],
        [x + 6, y + 8],
        [x + 2, y + 8],
      ],
      2,
    );
    sprite.rect(x + 3, y + 2, 2, 4, 4);
  }
  return sprite.pixels;
}
