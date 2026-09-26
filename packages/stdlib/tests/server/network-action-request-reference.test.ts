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
  {
    type: 'interact',
    intent: 'use',
    target: { kind: 'self' },
    expectedSelection: { inventoryRevision: 2, modeRevision: 1, creativeCatalogRevision: 1, selectedSlot: 0 },
  },
  {
    type: 'interact',
    intent: 'alternate',
    target: { kind: 'voxel', hit: [-1, 0, 1], adjacent: [-1, 1, 1] },
    expectedSelection: { inventoryRevision: 3, modeRevision: 1, creativeCatalogRevision: 1, selectedSlot: 1 },
  },
  {
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: { entityId: 'creature-1', epoch: 2, lifetime: 3 } },
    expectedSelection: { inventoryRevision: 4, modeRevision: 1, creativeCatalogRevision: 2, selectedSlot: 2 },
  },
  { type: 'set-difficulty', value: 'hard', expectedRevision: 2 },
];
const interactionSelection = { inventoryRevision: 2, modeRevision: 1, creativeCatalogRevision: 1, selectedSlot: 0 };

describe('动作请求参考投影', () => {
  it('投影十三种真实 Host 参数，复制动作且不携带客户端身份', () => {
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
      if (action.type === 'interact' && projected.action.type === 'interact') {
        expect(projected.action.target).not.toBe(action.target);
        if (action.target.kind === 'voxel' && projected.action.target.kind === 'voxel') {
          expect(projected.action.target.hit).not.toBe(action.target.hit);
          expect(projected.action.target.adjacent).not.toBe(action.target.adjacent);
        }
      }
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
    expect(() =>
      projectActionRequestReference(
        {
          type: 'interact',
          target: { kind: 'self' },
          expectedSelection: interactionSelection,
        } as AuthorityAction,
        0,
      ),
    ).toThrow(/intent/i);
    expect(() =>
      projectActionRequestReference(
        {
          type: 'interact',
          intent: 'toggle',
          target: { kind: 'self' },
          expectedSelection: interactionSelection,
        } as unknown as AuthorityAction,
        0,
      ),
    ).toThrow(/intent/i);
  });
});
