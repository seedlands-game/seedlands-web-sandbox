import { expect, it, vi } from 'vitest';
import { orientNewPlayer } from '../../src/app/world/world-entry';

it('新世界面向营地，恢复玩家保持原朝向', () => {
  const controller = { setView: vi.fn() };
  const server = { queryPois: vi.fn(() => [{ position: [8.5, 10, 4.5] as [number, number, number] }]) };
  orientNewPlayer(controller, server, [0.5, 11.6, 0.5], true);
  const [yaw, pitch] = controller.setView.mock.calls[0];
  expect(yaw).toBeCloseTo(-116.565, 2);
  expect(pitch).toBeLessThan(0);
  orientNewPlayer(controller, server, [0.5, 11.6, 0.5], false);
  expect(controller.setView).toHaveBeenCalledTimes(1);
});
