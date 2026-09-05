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

it('昼夜暂停和加速按键通过Authority回调而非只改本地显示', () => {
  const windowStub = { onkeydown: null as null | ((event: object) => void) };
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', {});
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const setPaused = vi.fn();
  const setSpeed = vi.fn();
  const options = {
    canvas: {},
    getEnvironment: () => ({ paused: false, speed: 1 }),
    isPaused: () => false,
    isUiBlockingInput: () => false,
    onSetWorldClockPaused: setPaused,
    onSetWorldClockSpeed: setSpeed,
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  controller.install();

  windowStub.onkeydown!({ code: 'KeyP', target: {}, preventDefault: vi.fn() });
  windowStub.onkeydown!({ code: 'KeyT', target: {}, preventDefault: vi.fn() });

  expect(setPaused).toHaveBeenCalledWith(true);
  expect(setSpeed).toHaveBeenCalledWith(20);
});

it('按住F3再按B切换真实碰撞箱', () => {
  const windowStub = {
    onkeydown: null as null | ((event: object) => void),
    onkeyup: null as null | ((event: object) => void),
  };
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', {});
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const toggleDebug = vi.fn();
  const toggleCollisionDebug = vi.fn();
  const options = {
    canvas: {},
    getEnvironment: () => null,
    isPaused: () => false,
    isUiBlockingInput: () => false,
    onToggleDebug: toggleDebug,
    onToggleCollisionDebug: toggleCollisionDebug,
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  controller.install();

  windowStub.onkeydown!({ code: 'F3', target: {}, preventDefault: vi.fn(), repeat: false });
  windowStub.onkeydown!({ code: 'KeyB', target: {}, preventDefault: vi.fn(), repeat: false });

  expect(toggleDebug).toHaveBeenCalledOnce();
  expect(toggleCollisionDebug).toHaveBeenCalledOnce();
});
