import { expect, it, vi } from 'vitest';
import { ready } from '../client/fixtures/browser-authority';
import {
  defineTransportV1,
  type TransportStateV2,
} from '../../../../../packages/stdlib/src/server/gameplay/modules/transport-model';
import {
  transportTargetAction,
  performTransportTargetInteraction,
} from '../../../src/app/gameplay/transport-target-interaction';

const definition = defineTransportV1({
  version: 1,
  id: 'test:cart',
  locomotion: { provider: 'route', providerId: 'test:rail' },
  bodyAabb: { min: { x: -0.8, y: 0, z: -0.2 }, max: { x: 0.8, y: 0.7, z: 0.2 } },
  seatOffset: [0, 0.55, 0],
  presentationId: 'test:model',
});
const cart: TransportStateV2 = {
  version: 2,
  reference: { entityId: 'cart', lifetime: 7 },
  definitionId: definition.id,
  pose: { position: [0, 0, -3], yaw: Math.PI / 2 },
  velocity: [0, 0, 0],
  routeCursor: null,
  rider: null,
  fuel: null,
  inventory: [],
};
const gameplay = () => ({ ...ready().gameplay, transports: [cart], transportDefinitions: [definition] });

it('native ray submits accepted lifetime and four selection revisions without changing the view', () => {
  const view = gameplay();
  const before = structuredClone(view);
  expect(transportTargetAction(view, [0, 0.3, 0], [0, 0, -1], 5, 'use')).toEqual({
    type: 'interact',
    intent: 'use',
    target: { kind: 'entity', reference: cart.reference },
    expectedSelection: { inventoryRevision: 0, modeRevision: 0, creativeCatalogRevision: 0, selectedSlot: 0 },
  });
  expect(view).toEqual(before);
});
it('yaw, voxel occlusion, reach, invalid rays and missing accepted definition reject a pick', () => {
  const view = gameplay();
  expect(transportTargetAction(view, [0.5, 0.3, 0], [0, 0, -1], 5, 'use')).toBeNull();
  expect(transportTargetAction(view, [0, 0.3, 0], [0, 0, -1], 2, 'use')).toBeNull();
  expect(transportTargetAction(view, [0, 0.3, 0], [0, 0, 0], 5, 'use')).toBeNull();
  expect(transportTargetAction({ ...view, transportDefinitions: [] }, [0, 0.3, 0], [0, 0, -1], 5, 'use')).toBeNull();
});
it('alternate while mounted submits self even without an aimed cart', () => {
  const view = gameplay();
  view.transports = [{ ...cart, rider: { entityId: view.player.entityId, lifetime: 1 } }];
  expect(transportTargetAction(view, [0, 0, 0], [0, 1, 0], 0, 'alternate')).toMatchObject({
    type: 'interact',
    intent: 'alternate',
    target: { kind: 'self' },
  });
});
it('rejected authority action remains handled, shows the failure and never saves or reports success', async () => {
  const input = {
    gameplay: gameplay(),
    origin: [0, 0.3, 0] as const,
    direction: [0, 0, -1] as const,
    maxDistance: 5,
    intent: 'use' as const,
    perform: vi.fn().mockResolvedValue({ result: { success: false, reason: 'stale-lifetime' } }),
    refresh: vi.fn(),
    succeeded: vi.fn(),
    failed: vi.fn(),
  };
  expect(await performTransportTargetInteraction(input)).toBe('handled');
  expect(input.failed).toHaveBeenCalledWith('stale-lifetime');
  expect(input.succeeded).not.toHaveBeenCalled();
});
