import { describe, expect, it } from 'vitest';
import { projectActionRequestReference } from '../../src/server/protocol/network-action-request-reference';
import type { AuthorityAction } from '../../src/server/protocol/authority-worker-protocol';

const actions: readonly AuthorityAction[] = [
  { type: 'select-hotbar', slot: Number.MAX_SAFE_INTEGER },
  { type: 'craft', recipeId: 'planks' },
  { type: 'attack', targetId: 'creature-1' },
  { type: 'begin-break', position: [-2147483649, 34, 2147483648] },
  { type: 'cancel-break' },
  { type: 'place', position: [-1, 0, 1] },
  { type: 'respawn' },
  { type: 'move-inventory', source: 0, target: Number.MAX_SAFE_INTEGER },
  { type: 'use-inventory', slot: Number.MAX_SAFE_INTEGER },
];

describe('动作请求参考投影', () => {
  it('投影九种真实 Host 参数，复制动作且不携带客户端身份', () => {
    for (const [sequence, action] of actions.entries()) {
      const projected = projectActionRequestReference(action, sequence);
      expect(projected).toEqual({
        kind: 'action-request-reference',
        projectionVersion: 1,
        action,
        sequence,
      });
      expect(projected).not.toHaveProperty('epoch');
      expect(projected).not.toHaveProperty('issuer');
      expect(projected).not.toHaveProperty('stream');
      expect(projected.action).not.toBe(action);
      if ('position' in action && 'position' in projected.action)
        expect(projected.action.position).not.toBe(action.position);
    }
  });

  it('拒绝越界字段、稀疏坐标和非法 sequence，并且不复制扩展字段', () => {
    expect(() => projectActionRequestReference({ type: 'unknown' } as unknown as AuthorityAction, 0)).toThrow(
      /action/i,
    );
    expect(() => projectActionRequestReference({ type: 'select-hotbar', slot: -1 }, 0)).toThrow(/slot/i);
    expect(() => projectActionRequestReference({ type: 'craft', recipeId: '' }, 0)).toThrow(/recipeId/i);
    expect(() => projectActionRequestReference({ type: 'attack', targetId: 'x'.repeat(257) }, 0)).toThrow(/targetId/i);
    expect(() => projectActionRequestReference({ type: 'place', position: [0, 1, 2.5] }, 0)).toThrow(/position/i);
    expect(() =>
      projectActionRequestReference({ type: 'place', position: Array(3) } as unknown as AuthorityAction, 0),
    ).toThrow(/position/i);
    expect(() => projectActionRequestReference({ type: 'cancel-break' }, -1)).toThrow(/sequence/i);
    expect(() => projectActionRequestReference({ type: 'cancel-break' }, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /sequence/i,
    );

    const extended = { type: 'select-hotbar' as const, slot: 2, capabilities: ['forged'] };
    expect(projectActionRequestReference(extended, 9).action).toEqual({ type: 'select-hotbar', slot: 2 });
  });
});
