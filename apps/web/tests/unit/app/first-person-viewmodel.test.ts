import * as pc from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import { FirstPersonViewmodel } from '../../../src/app/player/first-person-viewmodel';

vi.mock('../../../src/app/gameplay/gameplay-model-assets', () => ({
  acquireGameplayModelAssets: () => ({
    release: vi.fn(),
    assets: {
      addBox(parent: pc.Entity, name: string) {
        const child = new pc.Entity(name);
        parent.addChild(child);
        return child;
      },
      addItem(parent: pc.Entity, id: string) {
        parent.addChild(new pc.Entity(id));
      },
    },
  }),
}));

describe('第一人称手与物件的独立生命周期', () => {
  it.each(['place', 'eat'] as const)('消耗最后一个物品后保留 %s 动作并完成回位', (action) => {
    const camera = new pc.Entity();
    const model = new FirstPersonViewmodel({ graphicsDevice: { width: 1280, height: 720 } } as pc.Application, camera);
    const pivot = camera.findByName('viewmodel hand pivot')!;
    model.setHeldItem(action === 'place' ? 'lantern' : 'berry');
    model.setAction(action, true);
    // Authority has already consumed the selected stack before the next frame.
    model.setHeldItem(null);
    model.update(0.1);
    expect(pivot.getLocalEulerAngles().length()).toBeGreaterThan(1);
    model.update(0.5);
    expect(pivot.getLocalEulerAngles().length()).toBeCloseTo(0);
    model.dispose();
  });

  it('采集期间切换工具会停止原动作并平滑收手', () => {
    const camera = new pc.Entity();
    const model = new FirstPersonViewmodel({ graphicsDevice: { width: 1280, height: 720 } } as pc.Application, camera);
    const pivot = camera.findByName('viewmodel hand pivot')!;
    model.setHeldItem('wood-axe');
    model.setAction('mine');
    model.update(0.2);
    const before = pivot.getLocalRotation().clone();
    model.setHeldItem('stone-pickaxe');
    model.update(0);
    expect(pivot.getLocalRotation().equals(before)).toBe(true);
    model.update(0.16);
    expect(pivot.getLocalEulerAngles().length()).toBeCloseTo(0);
    model.dispose();
  });

  it('显式重播相同事件，持续采集不重启，停止时平滑收手', () => {
    const camera = new pc.Entity();
    const model = new FirstPersonViewmodel({ graphicsDevice: { width: 1280, height: 720 } } as pc.Application, camera);
    const pivot = camera.findByName('viewmodel hand pivot')!;
    model.setAction('attack', true);
    model.update(0.1);
    expect(pivot.getLocalEulerAngles().length()).toBeGreaterThan(1);
    model.setAction('attack', true);
    model.update(0);
    expect(pivot.getLocalEulerAngles().length()).toBeCloseTo(0);
    model.setAction('mine');
    model.update(0.2);
    const before = pivot.getLocalRotation().clone();
    model.setAction('mine');
    model.update(0);
    expect(pivot.getLocalRotation().equals(before)).toBe(true);
    model.setAction('idle');
    model.update(0);
    expect(pivot.getLocalRotation().equals(before)).toBe(true);
    model.update(0.16);
    expect(pivot.getLocalEulerAngles().length()).toBeCloseTo(0);
    model.dispose();
  });
  it('切换工具或空手不能销毁共享手臂构件，也不残留旧工具', () => {
    const camera = new pc.Entity();
    const model = new FirstPersonViewmodel({} as pc.Application, camera);
    expect(camera.findByName('hand')).not.toBeNull();
    model.setHeldItem('wood-axe');
    expect(camera.findByName('hand')).not.toBeNull();
    expect(camera.findByName('sleeve')).not.toBeNull();
    expect(camera.findByName('sleeve-cuff')).toBeNull();
    model.setHeldItem('stone-pickaxe');
    expect(camera.findByName('hand')).not.toBeNull();
    expect(camera.findByName('wood-axe')).toBeNull();
    expect(camera.findByName('stone-pickaxe')).not.toBeNull();
    model.setHeldItem(null);
    expect(camera.findByName('hand')).not.toBeNull();
    expect(camera.findByName('stone-pickaxe')).toBeNull();
    model.dispose();
    expect(camera.children).toHaveLength(0);
  });
});

it('不同窗口比例保持持握锚点在右侧安全范围', () => {
  const camera = new pc.Entity();
  const device = { width: 1280, height: 720 };
  const model = new FirstPersonViewmodel({ graphicsDevice: device } as pc.Application, camera);
  const root = camera.findByName('First person viewmodel')!;
  for (const width of [1920, 1280, 700]) {
    device.width = width;
    model.update(1 / 60);
    const projectedX =
      root.getLocalPosition().x / ((width / 720) * Math.tan(Math.PI / 5) * Math.abs(root.getLocalPosition().z));
    expect(projectedX).toBeGreaterThanOrEqual(0.38);
    expect(projectedX).toBeLessThanOrEqual(0.57);
  }
  model.dispose();
});

it('窄屏工具调整保持三个缩放轴有限，切换普通物品后恢复', () => {
  const camera = new pc.Entity();
  const device = { width: 720, height: 960 };
  const model = new FirstPersonViewmodel({ graphicsDevice: device } as pc.Application, camera);
  const item = camera.findByName('viewmodel replaceable item')!;
  model.setHeldItem('wood-sword');
  model.update(0);
  const scale = item.getLocalScale();
  expect([scale.x, scale.y, scale.z].every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  expect(scale.x).toBe(scale.y);
  expect(scale.y).toBe(scale.z);
  model.setHeldItem('plank');
  model.update(0);
  expect(item.getLocalScale().equals(pc.Vec3.ONE)).toBe(true);
  expect(item.getLocalEulerAngles().length()).toBeCloseTo(0);
  model.dispose();
});
