import { describe, expect, it } from 'vitest';
import { BrowserAuthorityIngress } from '../../../src/worker/authority-worker-ingress';

const expectedSelection = { inventoryRevision: 1, modeRevision: 2, creativeCatalogRevision: 3, selectedSlot: 4 };

describe('Browser Authority worker gameplay action ingress', () => {
  it('returns only the canonical action consumed by Authority', () => {
    const ingress = new BrowserAuthorityIngress('player');
    const action = {
      type: 'interact',
      intent: 'use',
      target: { kind: 'voxel', hit: [0, 0, 0], adjacent: [1, 0, 0] },
      expectedSelection,
    } as const;
    expect(ingress.action(action)).toEqual(action);
  });

  it.each([
    ['missing intent', { type: 'interact', target: { kind: 'self' }, expectedSelection }],
    ['invalid intent', { type: 'interact', intent: 'toggle', target: { kind: 'self' }, expectedSelection }],
    [
      'operation id',
      { type: 'interact', intent: 'use', target: { kind: 'self' }, expectedSelection, operationId: 'evil:op' },
    ],
    ['item id', { type: 'interact', intent: 'use', target: { kind: 'self' }, expectedSelection, itemId: 'evil:item' }],
    [
      'nested target field',
      {
        type: 'interact',
        intent: 'use',
        target: { kind: 'voxel', hit: [0, 0, 0], adjacent: [1, 0, 0], operationId: 'evil:op' },
        expectedSelection,
      },
    ],
    [
      'diagonal adjacent',
      {
        type: 'interact',
        intent: 'use',
        target: { kind: 'voxel', hit: [0, 0, 0], adjacent: [1, 1, 0] },
        expectedSelection,
      },
    ],
  ] as const)('rejects %s at the actual worker ingress', (_name, action) => {
    const ingress = new BrowserAuthorityIngress('player');
    expect(() => ingress.action(action)).toThrow();
  });
});
