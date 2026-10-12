import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { createTransportDefinitionRegistryV1 } from '../../src/server/gameplay/modules/transport-model';
import {
  buildTransportStorageCandidateV1,
  readTransportStorageInputV1,
  type TransportStorageActorV1,
  type TransportStorageSiteV1,
} from '../../src/server/gameplay/modules/transport-storage-model';

const items = createGameplayContent({
  items: [
    { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
    { id: 'test:coal', name: 'Coal', itemType: 'resource', stackLimit: 64, capabilities: [] },
    { id: 'test:tool', name: 'Tool', itemType: 'tool', stackLimit: 1, durability: { max: 10 }, capabilities: [] },
  ],
  recipes: [],
  meleeDefinitions: [],
}).items;
const definitions = createTransportDefinitionRegistryV1(
  [
    { id: 'test:cargo', inventoryCapacity: 2, fuelCapacity: null },
    { id: 'test:engine', inventoryCapacity: null, fuelCapacity: 360 },
    { id: 'test:plain', inventoryCapacity: null, fuelCapacity: null },
  ].map((entry) => ({
    ...entry,
    version: 1 as const,
    locomotion: { provider: 'route' as const, providerId: 'test:rail' },
    bodyAabb: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } },
    seatOffset: [0, 0.5, 0],
    presentationId: 'test:cart',
  })),
);
const content = { definitions, items, fuels: [{ definitionId: 'test:engine', itemId: 'test:coal', units: 180 }] };
const fixture = () => {
  const actor: TransportStorageActorV1 = {
    reference: { entityId: 'player', epoch: 1, lifetime: 1 },
    alive: true,
    cursorBusy: false,
    inventoryRevision: 3,
    slots: [
      { itemId: 'test:coal', count: 8 },
      { itemId: 'test:wood', count: 60 },
      { itemId: 'test:tool', count: 1, instance: { durability: 5 } },
      null,
    ],
  };
  const site: TransportStorageSiteV1 = {
    reference: { entityId: 'cart', epoch: 1, lifetime: 2 },
    component: {
      version: 1,
      entityId: 'cart',
      revision: 7,
      definitionId: 'test:cargo',
      yaw: 0,
      routeCursor: {
        family: 'test:rail',
        cell: [0, 0, 0],
        variant: 'test:straight',
        entry: { side: 'north', elevation: 0 },
        exit: { side: 'south', elevation: 0 },
        progress: 0.5,
        segmentLength: 1,
      },
      rider: null,
      fuel: null,
      inventory: [{ itemId: 'test:wood', count: 3 }, null],
    },
  };
  const input: Record<string, unknown> = {
    version: 1,
    actor: actor.reference,
    transport: site.reference,
    expectedInventoryRevision: 3,
    expectedTransportRevision: 7,
    command: { kind: 'transfer', direction: 'deposit', actorSlot: 1, transportSlot: 0, count: 4 },
  };
  return { actor, site, input };
};
type Fixture = ReturnType<typeof fixture>;
const build = (f: Fixture) => buildTransportStorageCandidateV1(content, f.actor, f.site, f.input);
const engine = (f: Fixture) => {
  f.site = { ...f.site, component: { ...f.site.component, definitionId: 'test:engine', fuel: 12.5, inventory: [] } };
  f.input.command = { kind: 'refuel', actorSlot: 0, count: 1 };
};

describe('transport storage candidate contract', () => {
  it('conserves items on deposit and advances both revisions exactly once without editing the input', () => {
    const f = fixture(),
      before = structuredClone(f);
    const next = build(f);
    expect(next.slots[1]).toEqual({ itemId: 'test:wood', count: 56 });
    expect(next.component.inventory[0]).toEqual({ itemId: 'test:wood', count: 7 });
    expect(next.inventoryRevision).toBe(4);
    expect(next.component.revision).toBe(8);
    expect(f).toEqual(before);
  });
  it('withdraws into an existing compatible stack and retires an empty cargo slot', () => {
    const f = fixture();
    f.input.command = { kind: 'transfer', direction: 'withdraw', actorSlot: 1, transportSlot: 0, count: 3 };
    const next = build(f);
    expect(next.slots[1]).toEqual({ itemId: 'test:wood', count: 63 });
    expect(next.component.inventory[0]).toBeNull();
  });
  it('copies and freezes a durable item instance without sharing caller-owned references', () => {
    const f = fixture();
    f.input.command = { kind: 'transfer', direction: 'deposit', actorSlot: 2, transportSlot: 1, count: 1 };
    const next = build(f);
    expect(next.slots[2]).toBeNull();
    expect(next.component.inventory[1]).toEqual(f.actor.slots[2]);
    expect(next.component.inventory[1]?.instance).not.toBe(f.actor.slots[2]?.instance);
    expect(Object.isFrozen(next.component.inventory[1]?.instance)).toBe(true);
    expect(next.actor).not.toBe(f.actor.reference);
    expect(next.transport).not.toBe(f.site.reference);
  });
  it('consumes only configured whole fuel items and preserves fractional residual fuel', () => {
    const f = fixture();
    engine(f);
    const before = structuredClone(f),
      next = build(f);
    expect(next.component.fuel).toBe(192.5);
    expect(next.component.inventory).toEqual([]);
    expect(next.slots[0]).toEqual({ itemId: 'test:coal', count: 7 });
    expect(f).toEqual(before);
  });
  const failures: Array<{ name: string; edit: (f: Fixture) => void }> = [
    {
      name: 'dead actor',
      edit: (f) => {
        f.actor = { ...f.actor, alive: false };
      },
    },
    {
      name: 'busy cursor',
      edit: (f) => {
        f.actor = { ...f.actor, cursorBusy: true };
      },
    },
    {
      name: 'old actor epoch',
      edit: (f) => {
        f.input.actor = { ...f.actor.reference, epoch: 2 };
      },
    },
    {
      name: 'old carrier lifetime',
      edit: (f) => {
        f.input.transport = { ...f.site.reference, lifetime: 3 };
      },
    },
    {
      name: 'old actor revision',
      edit: (f) => {
        f.input.expectedInventoryRevision = 2;
      },
    },
    {
      name: 'old carrier revision',
      edit: (f) => {
        f.input.expectedTransportRevision = 6;
      },
    },
    {
      name: 'foreign component',
      edit: (f) => {
        f.site = { ...f.site, component: { ...f.site.component, entityId: 'other' } };
      },
    },
    {
      name: 'actor revision exhaustion',
      edit: (f) => {
        f.actor = { ...f.actor, inventoryRevision: Number.MAX_SAFE_INTEGER };
        f.input.expectedInventoryRevision = Number.MAX_SAFE_INTEGER;
      },
    },
    {
      name: 'carrier revision exhaustion',
      edit: (f) => {
        f.site = { ...f.site, component: { ...f.site.component, revision: Number.MAX_SAFE_INTEGER } };
        f.input.expectedTransportRevision = Number.MAX_SAFE_INTEGER;
      },
    },
    {
      name: 'source quantity insufficient',
      edit: (f) => {
        f.input.command = { kind: 'transfer', direction: 'deposit', actorSlot: 1, transportSlot: 0, count: 61 };
      },
    },
    {
      name: 'empty source',
      edit: (f) => {
        f.input.command = { kind: 'transfer', direction: 'deposit', actorSlot: 3, transportSlot: 0, count: 1 };
      },
    },
    {
      name: 'different stack identity',
      edit: (f) => {
        f.input.command = { kind: 'transfer', direction: 'deposit', actorSlot: 0, transportSlot: 0, count: 1 };
      },
    },
    {
      name: 'destination stack overflow',
      edit: (f) => {
        f.input.command = { kind: 'transfer', direction: 'withdraw', actorSlot: 1, transportSlot: 0, count: 3 };
        f.actor = {
          ...f.actor,
          slots: f.actor.slots.map((s, i) => (i === 1 ? { itemId: 'test:wood', count: 63 } : s)),
        };
      },
    },
    {
      name: 'cargo slot outside capacity',
      edit: (f) => {
        f.input.command = { kind: 'transfer', direction: 'deposit', actorSlot: 1, transportSlot: 2, count: 1 };
      },
    },
    {
      name: 'actor slot outside capacity',
      edit: (f) => {
        f.input.command = { kind: 'transfer', direction: 'deposit', actorSlot: 4, transportSlot: 1, count: 1 };
      },
    },
    {
      name: 'plain vehicle cannot store cargo',
      edit: (f) => {
        f.site = { ...f.site, component: { ...f.site.component, definitionId: 'test:plain', inventory: [] } };
      },
    },
    {
      name: 'unsupported fuel item',
      edit: (f) => {
        engine(f);
        f.input.command = { kind: 'refuel', actorSlot: 1, count: 1 };
      },
    },
    {
      name: 'fuel capacity overflow',
      edit: (f) => {
        engine(f);
        f.input.command = { kind: 'refuel', actorSlot: 0, count: 2 };
      },
    },
    {
      name: 'non-fuel carrier',
      edit: (f) => {
        f.input.command = { kind: 'refuel', actorSlot: 0, count: 1 };
      },
    },
    {
      name: 'extra input field',
      edit: (f) => {
        f.input.untrusted = true;
      },
    },
    {
      name: 'fractional quantity',
      edit: (f) => {
        f.input.command = { kind: 'refuel', actorSlot: 0, count: 0.5 };
      },
    },
    {
      name: 'zero quantity',
      edit: (f) => {
        f.input.command = { kind: 'refuel', actorSlot: 0, count: 0 };
      },
    },
    {
      name: 'extra command field',
      edit: (f) => {
        f.input.command = { kind: 'refuel', actorSlot: 0, count: 1, extra: true };
      },
    },
  ];
  const reasons: Record<string, string> = {
    'dead actor': 'actor-dead',
    'busy cursor': 'cursor-busy',
    'old actor epoch': 'actor-stale',
    'old carrier lifetime': 'reference-stale',
    'old actor revision': 'inventory-stale',
    'old carrier revision': 'component-stale',
    'foreign component': 'component-mismatch',
    'actor revision exhaustion': 'revision-exhausted',
    'carrier revision exhaustion': 'revision-exhausted',
    'source quantity insufficient': 'insufficient-items',
    'empty source': 'insufficient-items',
    'different stack identity': 'identity-mismatch',
    'destination stack overflow': 'destination-full',
    'cargo slot outside capacity': 'slot-invalid',
    'actor slot outside capacity': 'slot-invalid',
    'plain vehicle cannot store cargo': 'slot-invalid',
    'unsupported fuel item': 'fuel-rejected',
    'fuel capacity overflow': 'fuel-full',
    'non-fuel carrier': 'fuel-rejected',
    'extra input field': 'storage fields are invalid',
    'fractional quantity': 'command fields are invalid',
    'zero quantity': 'command fields are invalid',
    'extra command field': 'command fields are invalid',
  };
  it.each(failures)('rejects $name with both sides unchanged', ({ name, edit }) => {
    const f = fixture();
    edit(f);
    const before = structuredClone(f);
    expect(() => build(f)).toThrow(reasons[name]);
    expect(f).toEqual(before);
  });
  it('copies the command and both lifetime references when admitting a command', () => {
    const f = fixture(),
      input = readTransportStorageInputV1(f.input);
    expect(input.command).not.toBe(f.input.command);
    expect(input.actor).not.toBe(f.input.actor);
    expect(Object.isFrozen(input)).toBe(true);
  });
});
