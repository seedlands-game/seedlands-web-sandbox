import { afterEach, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { PlayerController } from '../../../src/app/player/player-controller';
import { applyAuthorityInputDecision } from '../../../src/app/player/game-player-controller';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import { createVoxelGeometryRegistryV1 } from '../../../../../packages/stdlib/src/world/voxel-geometry';
import type { World } from '../../../src/app/world/world-runtime';
import { ready } from '../client/fixtures/browser-authority';
import { InputCommandBuffer, type InputCommand } from '@seedlands/stdlib/runtime/session-protocol';

afterEach(() => vi.unstubAllGlobals());

function installKeyboard(inputPhysicsTick?: () => number) {
  const windowStub = {
    onkeydown: null as null | ((event: object) => void),
    onkeyup: null as null | ((event: object) => void),
  };
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', {});
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  let blocked = false;
  const initial = ready().snapshot;
  const snapshot = { ...initial, player: { ...initial.player } };
  const commands: InputCommand[] = [];
  const canvas = {};
  const controller = new PlayerController({
    camera: new pc.Entity(),
    canvas,
    physicsHz: 60,
    authority: {
      epoch: snapshot.epoch,
      snapshot: () => snapshot,
      inputPhysicsTick,
      sendInput: (command: InputCommand) => commands.push(command),
    },
    getEnvironment: () => null,
    getWorld: () => null,
    isPaused: () => false,
    isUiBlockingInput: () => blocked,
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  controller.install();
  const keyDown = (code: string) => windowStub.onkeydown!({ code, target: {}, preventDefault: vi.fn() });
  const keyUp = (code: string) => windowStub.onkeyup!({ code });
  return {
    controller,
    canvas,
    snapshot,
    commands,
    keyDown,
    keyUp,
    block: () => {
      blocked = true;
    },
  };
}

it('两帧之间的100ms真实键盘脉冲仍经正式输入队列持续移动并松开，不制造预测步', () => {
  const { controller, snapshot, commands, keyDown, keyUp } = installKeyboard();
  const input = new InputCommandBuffer(snapshot.epoch, 'player-input');
  const startTick = snapshot.physicsTick;
  keyDown('KeyS');
  expect(commands).toHaveLength(1);
  expect(input.push(commands[0]!)).toBe('accepted');
  for (let tick = startTick + 2; tick < startTick + 8; tick++) {
    expect(input.consumeForTick(tick).state.moveZ).toBe(1);
  }
  snapshot.physicsTick = startTick + 6;
  keyUp('KeyS');
  expect(commands).toHaveLength(2);
  expect(input.push(commands[1]!)).toBe('accepted');
  expect(input.consumeForTick(startTick + 8).state.moveZ).toBe(0);
  expect(controller.predictedPhysicsState).toBeNull();
  expect(controller.predictionDiagnostics.pendingFrames).toBe(0);
});

it('旧snapshot期间真实keydown/up与失焦neutral都采用同一投递时钟', () => {
  let schedulingTick = 130;
  const { controller, snapshot, commands, keyDown, keyUp } = installKeyboard(() => schedulingTick);
  snapshot.physicsTick = 100;
  const input = new InputCommandBuffer(snapshot.epoch, 'player-input');
  input.consumeForTick(130);
  keyDown('KeyS');
  expect(commands[0]!.targetPhysicsTick).toBe(132);
  expect(input.push(commands[0]!)).toBe('accepted');
  schedulingTick = 136;
  keyUp('KeyS');
  expect(commands[1]!.targetPhysicsTick).toBe(138);
  expect(input.push(commands[1]!)).toBe('accepted');
  schedulingTick = 140;
  controller.releaseInput();
  expect(commands[2]!.targetPhysicsTick).toBe(142);
  expect(input.push(commands[2]!)).toBe('accepted');
  expect(snapshot.physicsTick).toBe(100);
  expect(controller.predictedPhysicsState).toBeNull();
});

it('键盘边沿保留jump和movement identity，重复按下与UI阻挡不新增运动', () => {
  const { snapshot, commands, keyDown, keyUp, block } = installKeyboard();
  snapshot.player.movement = { revision: 'creative:1:true:1', flightSpeed: 8 };
  keyDown('Space');
  keyDown('Space');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    movementRevision: 'creative:1:true:1',
    edges: { jumpPressed: true },
    state: { jumpHeld: true },
  });
  block();
  keyDown('KeyW');
  expect(commands).toHaveLength(1);
  keyUp('Space');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({
    sequence: 1,
    edges: { jumpPressed: false },
    state: { moveX: 0, moveZ: 0, jumpHeld: false, verticalIntent: 0 },
  });
});

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
  let now = 0;
  const monotonicClock = vi.spyOn(performance, 'now').mockImplementation(() => now);
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
  now = 190;
  controller.update(0.05, 0.19);
  expect(attack).toHaveBeenCalledTimes(1);
  now = 250;
  controller.update(0.05, 0.06);
  expect(attack).toHaveBeenCalledTimes(2);
  now = 2_250;
  controller.update(0.05, 2);
  expect(attack).toHaveBeenCalledTimes(3);
  blocked = true;
  now = 2_500;
  controller.update(0.05, 0.25);
  blocked = false;
  now = 2_750;
  controller.update(0.05, 0.25);
  expect(attack).toHaveBeenCalledTimes(3);
  controller.dispose(false);
  monotonicClock.mockRestore();
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
    camera: new pc.Entity(),
    physicsHz: 60,
    mouseSensitivity,
    getWorld: () => null,
    isUiBlockingInput: () => false,
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  controller.install();
  documentStub.onmousemove?.({ movementX: 4, movementY: 2 });
  expect(controller.viewAngles).toEqual([-1, -16.5]);
});

it('未按住鼠标时真实 Pointer Lock 转向立即更新射线与目标卡，不依赖渲染或制造预测步', () => {
  const canvas = {};
  const documentStub = {
    pointerLockElement: canvas,
    onmousemove: null as null | ((event: { movementX: number; movementY: number }) => void),
  };
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', documentStub);
  const camera = new pc.Entity();
  camera.setPosition(0.5, 1.5, 0.5);
  const publish = vi.fn();
  const world = {
    authority: { voxelSemantics: { get: (voxel: number) => ({ targetable: voxel !== 0 }) } },
    getVoxel: (x: number, y: number, z: number) => (x === 2 && y === 1 && z === 0 ? 1 : 0),
    getFluidCell: () => null,
  };
  const controller = new PlayerController({
    canvas,
    camera,
    physicsHz: 60,
    authority: { epoch: 'pointer-aim', snapshot: () => null },
    getWorld: () => world,
    isUiBlockingInput: () => false,
    canTargetFluidSource: () => false,
    onAimTarget: publish,
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  controller.install();
  try {
    expect(controller.aimTarget).toBeNull();
    documentStub.onmousemove!({ movementX: 90 / 0.13, movementY: -16 / 0.13 });
    expect(controller.viewAngles).toEqual([-90, 0]);
    expect(controller.aimTarget?.position).toEqual([2, 1, 0]);
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ position: [2, 1, 0] }));
    expect(controller.predictedPhysicsState).toBeNull();
    expect(controller.predictionDiagnostics.pendingFrames).toBe(0);
  } finally {
    controller.dispose(false);
  }
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

it('真实mousemove即时更新yaw，随后keyboard捕获相同方向，不等待render update', () => {
  const { controller, canvas, commands, keyDown } = installKeyboard();
  const mouseDocument = document as unknown as {
    pointerLockElement: object;
    onmousemove: (event: { movementX: number; movementY: number }) => void;
  };
  mouseDocument.pointerLockElement = canvas;
  mouseDocument.onmousemove({ movementX: -80, movementY: 0 });
  expect(controller.viewAngles).toEqual([10.4, -16]);
  keyDown('KeyW');
  expect(commands).toHaveLength(1);
  expect(commands[0]!.state.moveX).toBeCloseTo(-Math.sin((10.4 * Math.PI) / 180), 6);
  expect(commands[0]!.state.moveZ).toBeCloseTo(-Math.cos((10.4 * Math.PI) / 180), 6);
  expect(controller.predictedPhysicsState).toBeNull();
});
