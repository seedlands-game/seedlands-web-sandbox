import { afterEach, expect, it, vi } from 'vitest';
import { PlayerController } from '../../src/app/player-controller';

afterEach(() => vi.unstubAllGlobals());

it('昼夜时钟暂停仍能操作，游戏暂停和界面阻挡才阻止世界交互', () => {
  const options = {
    getEnvironment: () => ({ paused: true }),
    isPaused: () => false,
    isUiBlockingInput: () => false,
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  expect(controller.interactionBlocked).toBe(false);
  options.isPaused = () => true;
  expect(controller.interactionBlocked).toBe(true);
  options.isPaused = () => false;
  options.isUiBlockingInput = () => true;
  expect(controller.interactionBlocked).toBe(true);
});

it('打开背包后 E 仍能关闭界面', () => {
  const windowStub = { onkeydown: null as null | ((event: object) => void) };
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', {});
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const toggle = vi.fn();
  const options = {
    canvas: {},
    getEnvironment: () => ({ paused: false }),
    isPaused: () => false,
    isUiBlockingInput: () => true,
    onToggleInventory: toggle,
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  controller.install();
  windowStub.onkeydown!({ code: 'KeyE', target: {}, preventDefault: vi.fn() });
  expect(toggle).toHaveBeenCalledOnce();
});
