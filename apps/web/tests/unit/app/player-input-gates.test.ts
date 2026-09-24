import { afterEach, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { PlayerController } from '../../../src/app/player/player-controller';
import { applyAuthorityInputDecision } from '../../../src/app/player/game-player-controller';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import { createVoxelGeometryRegistryV1 } from '../../../../../packages/stdlib/src/world/voxel-geometry';
import type { World } from '../../../src/app/world/world-runtime';
import { ready } from '../client/fixtures/browser-authority';

afterEach(() => vi.unstubAllGlobals());

const collisionGeometry = (collision: boolean) =>
  createVoxelGeometryRegistryV1([
    {
      version: 1,
      voxel: 500,
      boxes: [{ min: [0.4, 0, 0], max: [0.6, 1, 1], material: FaceMaterial.WoodenDoor }],
      collision: collision ? [{ min: [0.4, 0, 0], max: [0.6, 1, 1] }] : [],
      occludesFullFace: false,
    },
  ]);

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
    getWorld: () => ({
      authority: { voxelSemantics: { get: () => undefined }, voxelGeometry: undefined },
      getChunkRevision: () => 1,
      getVoxel: () => 0,
      getFluidCell: () => null,
    }),
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

it('碰撞查询每次使用当前world geometry，恢复替换后不保留旧registry', () => {
  let geometry = collisionGeometry(false);
  const world = {
    authority: {
      voxelSemantics: { get: () => undefined },
      get voxelGeometry() {
        return geometry;
      },
    },
    getChunkRevision: () => 1,
    getVoxel: () => 500,
    getFluidCell: () => null,
  } as unknown as World;
  const controller = new PlayerController({
    camera: new pc.Entity(),
    canvas: {},
    physicsHz: 60,
    authority: { epoch: 'world:1', snapshot: () => null },
    getWorld: () => world,
    getEnvironment: () => null,
    isUiBlockingInput: () => false,
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  const snapshot = ready().snapshot;
  controller.applyAuthoritySnapshot(snapshot);

  expect(controller.isColliding).toBe(false);
  geometry = collisionGeometry(true);
  expect(controller.isColliding).toBe(true);
});

it('鼠标灵敏度即时改变真实 Pointer Lock 转向幅度', () => {
  const canvas = {};
  const documentStub = {
    pointerLockElement: canvas,
    onmousemove: null as null | ((event: { movementX: number; movementY: number }) => void),
  };
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', documentStub);
  const mouseSensitivity = { value: 0.25 };
  const controller = new PlayerController({
    canvas,
    physicsHz: 60,
    mouseSensitivity,
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  controller.install();
  documentStub.onmousemove?.({ movementX: 4, movementY: 2 });
  expect(controller.viewAngles).toEqual([-1, -16.5]);
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
