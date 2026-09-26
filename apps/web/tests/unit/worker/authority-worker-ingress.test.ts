import { describe, expect, it } from 'vitest';
import { BrowserAuthorityIngress } from '../../../src/worker/authority-worker-ingress';
import { MEDIA_PLAYBACK_RESOURCE } from '@seedlands/stdlib/mod-api';

const expectedSelection = { inventoryRevision: 1, modeRevision: 2, creativeCatalogRevision: 3, selectedSlot: 4 };

describe('Browser Authority worker gameplay action ingress', () => {
  it('grants the bound player the registered media state operations', () => {
    const ingress = new BrowserAuthorityIngress('player', [
      { id: MEDIA_PLAYBACK_RESOURCE, operations: ['read', 'write', 'execute'] },
    ]);
    const authorization = (
      ingress as unknown as { authorization: { authorize(...args: unknown[]): { allowed: boolean } } }
    ).authorization;
    for (const operation of ['read', 'write', 'execute'] as const)
      expect(
        authorization.authorize('browser-player', {
          resource: MEDIA_PLAYBACK_RESOURCE,
          operation,
          target: { kind: 'voxel', position: [1, 2, 3] },
        }).allowed,
      ).toBe(true);
  });

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
