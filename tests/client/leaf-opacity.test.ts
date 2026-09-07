import { expect, it } from 'vitest';
import { leafOpacity } from '../../apps/web/src/client/presentation/leaf-opacity';

it('叶片轮廓周期连续，保留有界镂空而不成为棋盘格或实心方块', () => {
  let gaps = 0;
  for (let x = 0; x < 128; x++)
    for (let y = 0; y < 128; y++) {
      const alpha = leafOpacity(x, y, 100);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(255);
      if (alpha < 100) gaps++;
    }
  expect(gaps / (128 * 128)).toBeGreaterThan(0.12);
  expect(gaps / (128 * 128)).toBeLessThan(0.4);
  for (let t = 0; t <= 128; t += 8) {
    expect(leafOpacity(0, t, 100)).toBe(leafOpacity(128, t, 100));
    expect(leafOpacity(t, 0, 100)).toBe(leafOpacity(t, 128, 100));
  }
});
