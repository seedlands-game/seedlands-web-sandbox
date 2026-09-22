import { afterEach, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { PlayerController } from '../../../src/app/player/player-controller';

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve = () => undefined;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function installPlayerInput(options: {
  creative: () => boolean;
  onBeginBreak: (position: [number, number, number]) => void | Promise<void>;
  onAttackTarget?: () => boolean;
  onCancelBreak?: () => void;
  isUiBlockingInput?: () => boolean;
}) {
  const canvas = {} as HTMLCanvasElement;
  const documentStub = {
    pointerLockElement: canvas,
    onmousedown: null as null | ((event: { button: number; target?: unknown; shiftKey?: boolean }) => void),
    onmouseup: null as null | ((event: { button: number }) => void),
    onmousemove: null,
    onpointerlockchange: null,
    onvisibilitychange: null,
  };
  const windowStub = { onkeydown: null, onkeyup: null, onblur: null };
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const camera = new pc.Entity();
  camera.setPosition(0.5, 0.5, 0.5);
  let targetZ = -1;
  const controller = new PlayerController({
    canvas,
    camera,
    physicsHz: 60,
    authority: { epoch: 'test', snapshot: () => null, sendInput: vi.fn(), setPlayerPosition: vi.fn() },
    getWorld: () => ({
      getVoxel: (x: number, y: number, z: number) => (x === 0 && y === 0 && z === targetZ ? Voxel.Stone : Voxel.Air),
      getFluidCell: () => null,
    }),
    telemetry: {
      beginSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: (_category: string, _name: string, callback: () => void) => callback(),
    },
    isPaused: () => false,
    isUiBlockingInput: options.isUiBlockingInput ?? (() => false),
    isCreativeMode: options.creative,
    onAttackTarget: options.onAttackTarget ?? (() => false),
    onCancelBreak: options.onCancelBreak,
    onBeginBreak: (position) => {
      const result = options.onBeginBreak(position);
      targetZ -= 1;
      return result;
    },
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  controller.install();
  return { controller, documentStub };
}

afterEach(() => vi.unstubAllGlobals());

it('创造模式短按只提交一次；在途请求不积压，释放后的迟到回调不能恢复破坏', async () => {
  const first = deferred();
  const begin = vi.fn(() => first.promise);
  const { controller, documentStub } = installPlayerInput({ creative: () => true, onBeginBreak: begin });

  documentStub.onmousedown?.({ button: 0 });
  expect(begin).toHaveBeenCalledTimes(1);
  controller.update(0.01, 0.25);
  controller.update(0.01, 0.2);
  expect(begin).toHaveBeenCalledTimes(1);

  first.resolve();
  await Promise.resolve();
  controller.update(0.01, 0.19);
  expect(begin).toHaveBeenCalledTimes(1);
  controller.update(0.01, 0.01);
  expect(begin).toHaveBeenCalledTimes(2);

  documentStub.onmouseup?.({ button: 0 });
  controller.update(0.01, 1);
  expect(begin).toHaveBeenCalledTimes(2);
});

it('UI 阻挡和模式切换都会清除创造模式按住状态', () => {
  let blocked = false;
  let creative = true;
  const begin = vi.fn();
  const { controller, documentStub } = installPlayerInput({
    creative: () => creative,
    onBeginBreak: begin,
    isUiBlockingInput: () => blocked,
  });

  documentStub.onmousedown?.({ button: 0 });
  blocked = true;
  controller.update(0.01, 0.25);
  blocked = false;
  controller.update(0.01, 1);
  expect(begin).toHaveBeenCalledTimes(1);

  documentStub.onmousedown?.({ button: 0 });
  creative = false;
  controller.update(0.01, 0.25);
  creative = true;
  controller.update(0.01, 1);
  expect(begin).toHaveBeenCalledTimes(2);
});

it('攻击目标的同一短按不会向其背后的体素开始破坏', () => {
  const begin = vi.fn();
  const { documentStub } = installPlayerInput({
    creative: () => true,
    onBeginBreak: begin,
    onAttackTarget: () => true,
  });

  documentStub.onmousedown?.({ button: 0 });

  expect(begin).not.toHaveBeenCalled();
});

it('生存模式仍在目标变化时立即切换既有采集，而不等待创造模式节奏', () => {
  const begin = vi.fn();
  const cancel = vi.fn();
  const { controller, documentStub } = installPlayerInput({
    creative: () => false,
    onBeginBreak: begin,
    onCancelBreak: cancel,
  });

  documentStub.onmousedown?.({ button: 0 });
  controller.update(0.01, 0.01);

  expect(begin).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledOnce();
});
