import { describe, expect, it, vi } from 'vitest';
import { addBuiltinActorModel, addPlayerArm } from '../../../src/app/gameplay/builtin-actor-models';

const addBox = vi.fn();
const parent = { addChild: vi.fn() };

describe('内置角色外观绑定', () => {
  it('角色部件使用各自目录模型的私有材质绑定', () => {
    addBuiltinActorModel({ addBox } as never, parent as never, 'grazer');

    expect(addBox).toHaveBeenCalled();
    expect(addBox.mock.calls.every((call) => call[5]?.modelId === 'seedlands:model/actor/grazer')).toBe(true);
  });

  it('第一人称手臂使用独立的目录模型绑定', () => {
    addBox.mockClear();
    addPlayerArm({ addBox } as never, parent as never);

    expect(addBox).toHaveBeenCalled();
    expect(addBox.mock.calls.every((call) => call[5]?.modelId === 'seedlands:model/player-arm')).toBe(true);
  });
});
