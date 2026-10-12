import { expect, it, vi } from 'vitest';
import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { BrowserTransportStorage } from '../../../src/app/gameplay/browser-transport-storage';
import { ready } from './fixtures/browser-authority';

const site = {
  version: 1 as const,
  reference: { entityId: 'cargo', lifetime: 2, epoch: 1 },
  definitionId: 'sample:cargo',
  revision: 3,
  inventory: [{ itemId: 'stone', count: 2 }, null],
  fuel: null,
  fuelCapacity: null,
  fuels: [],
};
const command = { kind: 'transfer' as const, direction: 'deposit' as const, actorSlot: 0, transportSlot: 1, count: 1 };
const request = { command, expectedInventoryRevision: 5, expectedTransportRevision: 3 };
function setup() {
  const initial = ready().gameplay;
  let view: AuthorityGameplayView = {
    ...initial,
    inventory: { ...initial.inventory, revision: 5 },
    transportStorage: [site],
  };
  const perform = vi.fn(async (_action: unknown) => ({ result: { success: true } }));
  const refresh = vi.fn(),
    changed = vi.fn(),
    failed = vi.fn();
  const storage = new BrowserTransportStorage({ view: () => view, perform, refresh, changed, failed });
  return {
    storage,
    perform,
    refresh,
    changed,
    failed,
    view: () => view,
    replace: (next: AuthorityGameplayView) => {
      view = next;
    },
  };
}

it('opens an empty-cursor lifetime and submits one normal action with current owner references', async () => {
  const fixture = setup();
  expect(fixture.view().inventory.cursor.stack).toBeNull();
  expect(fixture.storage.open(site.reference)).toBe(true);
  expect(await fixture.storage.send(request)).toBe(true);
  expect(fixture.perform).toHaveBeenCalledExactlyOnceWith({
    type: 'transport-storage',
    version: 1,
    actor: fixture.view().inventory.actor,
    transport: site.reference,
    expectedInventoryRevision: 5,
    expectedTransportRevision: 3,
    command,
  });
  expect(fixture.changed).toHaveBeenCalledTimes(1);
});

it('rejects a stale UI revision without sending or changing owners', async () => {
  const fixture = setup();
  expect(fixture.storage.open(site.reference)).toBe(true);
  fixture.replace({ ...fixture.view(), inventory: { ...fixture.view().inventory, revision: 6 } });
  expect(await fixture.storage.send(request)).toBe(false);
  expect(fixture.perform).not.toHaveBeenCalled();
  expect(fixture.changed).not.toHaveBeenCalled();
  expect(fixture.refresh).toHaveBeenCalledTimes(1);
});

it('reads fresh site and inventory revisions without caching canonical state', async () => {
  const fixture = setup();
  expect(fixture.storage.open(site.reference)).toBe(true);
  fixture.replace({
    ...fixture.view(),
    inventory: { ...fixture.view().inventory, revision: 6 },
    transportStorage: [{ ...site, revision: 4 }],
  });
  expect(await fixture.storage.send({ ...request, expectedInventoryRevision: 6, expectedTransportRevision: 4 })).toBe(
    true,
  );
  expect(fixture.perform.mock.calls[0]![0]).toMatchObject({
    expectedInventoryRevision: 6,
    expectedTransportRevision: 4,
  });
});

it.each(['missing', 'dead', 'cursor', 'epoch'])('clears local selection for %s and sends no action', async (kind) => {
  const fixture = setup();
  expect(fixture.storage.open(site.reference)).toBe(true);
  const view = fixture.view();
  fixture.replace({
    ...view,
    ...(kind === 'missing' ? { transportStorage: [] } : {}),
    ...(kind === 'dead' ? { player: { ...view.player, lifecycle: 'dead' as const } } : {}),
    ...(kind === 'cursor'
      ? { inventory: { ...view.inventory, cursor: { ...view.inventory.cursor, stack: { itemId: 'stone', count: 1 } } } }
      : {}),
    ...(kind === 'epoch' ? { transportStorage: [{ ...site, reference: { ...site.reference, epoch: 2 } }] } : {}),
  });
  expect(fixture.storage.current()).toBeNull();
  expect(await fixture.storage.send(request)).toBe(false);
  expect(fixture.perform).not.toHaveBeenCalled();
});

it.each(['dispose', 'epoch'])('suppresses completion callbacks when an in-flight request crosses %s', async (kind) => {
  const fixture = setup();
  let complete: (value: { result: { success: boolean } }) => void = () => {
    throw Error('Request not started');
  };
  fixture.perform.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  expect(fixture.storage.open(site.reference)).toBe(true);
  const pending = fixture.storage.send(request);
  expect(await fixture.storage.send(request)).toBe(false);
  if (kind === 'dispose') fixture.storage.dispose();
  else {
    const view = fixture.view();
    fixture.replace({ ...view, inventory: { ...view.inventory, actor: { ...view.inventory.actor, epoch: 2 } } });
  }
  complete({ result: { success: true } });
  expect(await pending).toBe(false);
  expect(fixture.perform).toHaveBeenCalledTimes(1);
  expect(fixture.changed).not.toHaveBeenCalled();
  expect(fixture.refresh).not.toHaveBeenCalled();
  expect(fixture.failed).not.toHaveBeenCalled();
});
