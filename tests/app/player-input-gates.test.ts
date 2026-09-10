import { afterEach, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { PlayerController } from '../../apps/web/src/app/player/player-controller';
import { applyAuthorityInputDecision } from '../../apps/web/src/app/player/game-player-controller';

afterEach(() => vi.unstubAllGlobals());

it('低帧率下攻击重复使用真实经过时间，长帧不补发积压且界面阻挡立即停止', () => {
  const canvas = {};
  const documentStub = {
    pointerLockElement: canvas,
    onmousedown: null as null | ((event: { button: number }) => void),
  };
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', documentStub);
  const attack = vi.fn(() => true);
  let blocked = false;
  const options = {
    canvas,
    camera: new pc.Entity(),
    physicsHz: 60,
    authority: { epoch: 'test', snapshot: () => null },
    getWorld: () => ({ getVoxel: () => 0, getFluidCell: () => null }),
    telemetry: {
      beginSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: (_category: string, _name: string, callback: () => void) => callback(),
    },
    isUiBlockingInput: () => blocked,
    onAttackTarget: attack,
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  controller.install();
  documentStub.onmousedown?.({ button: 0 });
  expect(attack).toHaveBeenCalledTimes(1);
  controller.update(0.05, 0.19);
  expect(attack).toHaveBeenCalledTimes(1);
  controller.update(0.05, 0.06);
  expect(attack).toHaveBeenCalledTimes(2);
  controller.update(0.05, 2);
  expect(attack).toHaveBeenCalledTimes(3);
  blocked = true;
  controller.update(0.05, 0.25);
  blocked = false;
  controller.update(0.05, 0.25);
  expect(attack).toHaveBeenCalledTimes(3);
});

it('只在Authority明确作废输入队列时重同步预测', () => {
  const resynchronizeInput = vi.fn();
  const controller = { resynchronizeInput } as Pick<PlayerController, 'resynchronizeInput'>;

  applyAuthorityInputDecision(controller, { requiresResync: false });
  expect(resynchronizeInput).not.toHaveBeenCalled();

  applyAuthorityInputDecision(controller, { requiresResync: true });
  expect(resynchronizeInput).toHaveBeenCalledOnce();
});

it('昼夜时钟暂停仍能操作，游戏暂停和界面阻挡才阻止世界交互', () => {
  const options = {
    physicsHz: 60,
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
    physicsHz: 60,
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
    physicsHz: 60,
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
  expect(setSpeed).not.toHaveBeenCalled();
  windowStub.onkeydown!({ code: 'KeyT', altKey: true, target: {}, preventDefault: vi.fn() });

  expect(setPaused).toHaveBeenCalledWith(true);
  expect(setSpeed).toHaveBeenCalledWith(20);
  expect(setSpeed).toHaveBeenCalledOnce();
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
    physicsHz: 60,
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
  windowStub.onkeyup!({ code: 'F3' });

  expect(toggleDebug).not.toHaveBeenCalled();
  expect(toggleCollisionDebug).toHaveBeenCalledOnce();
});

it('单独短按F3只在松开时切换普通调试面板', () => {
  const windowStub = {
    onkeydown: null as null | ((event: object) => void),
    onkeyup: null as null | ((event: object) => void),
  };
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', {});
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const toggleDebug = vi.fn();
  const options = {
    canvas: {},
    physicsHz: 60,
    getEnvironment: () => null,
    isPaused: () => false,
    isUiBlockingInput: () => false,
    onToggleDebug: toggleDebug,
    onToggleCollisionDebug: vi.fn(),
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  controller.install();

  windowStub.onkeydown!({ code: 'F3', target: {}, preventDefault: vi.fn(), repeat: false });
  windowStub.onkeydown!({ code: 'F3', target: {}, preventDefault: vi.fn(), repeat: true });
  expect(toggleDebug).not.toHaveBeenCalled();
  windowStub.onkeyup!({ code: 'F3' });
  expect(toggleDebug).toHaveBeenCalledOnce();
});

it('窗口失焦通过生产控制器立即发送递增序号的全零输入', () => {
  const windowStub = { onblur: null as null | (() => void) };
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', { pointerLockElement: null });
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const sendInput = vi.fn();
  const options = {
    canvas: {},
    physicsHz: 60,
    authority: {
      epoch: 'world:1',
      snapshot: () => ({ physicsTick: 20, player: { movement: { revision: 'creative:1:true:1', flightSpeed: 8 } } }),
      sendInput,
    },
    getEnvironment: () => null,
    isPaused: () => false,
    isUiBlockingInput: () => false,
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
  const controller = new PlayerController(options);
  controller.install();

  windowStub.onblur?.();

  expect(sendInput).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'input',
      epoch: 'world:1',
      sequence: 0,
      targetPhysicsTick: 22,
      movementRevision: 'creative:1:true:1',
      state: { moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    }),
  );
});
