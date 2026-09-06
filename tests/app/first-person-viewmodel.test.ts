import * as pc from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import { FirstPersonViewmodel } from '../../src/app/first-person-viewmodel';

vi.mock('../../src/app/gameplay-model-assets', () => ({
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
  it('切换工具或空手不能销毁手掌/袖口，也不残留旧工具', () => {
    const camera = new pc.Entity();
    const model = new FirstPersonViewmodel({} as pc.Application, camera);
    expect(camera.findByName('hand')).not.toBeNull();
    model.setHeldItem('wood-axe');
    expect(camera.findByName('hand')).not.toBeNull();
    expect(camera.findByName('sleeve-cuff')).not.toBeNull();
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
    expect(projectedX).toBeLessThanOrEqual(0.44);
  }
  model.dispose();
});
