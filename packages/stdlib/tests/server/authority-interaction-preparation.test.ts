import { describe, expect, it } from 'vitest';
import { AuthorityMutationPreparation } from '../../src/server/authority/authority-mutation-preparation';
import { testCorePlatform } from '../support/core-platform';

const reference = { entityId: 'target', epoch: 1, lifetime: 2 } as const;

describe('Authority interaction mutation preparation', () => {
  it('prepares both voxel hit and adjacent Chunks', async () => {
    const prepared: string[] = [];
    const gate = new AuthorityMutationPreparation(
      {
        worldRevision: 0,
        getEntity: (id) => (id === 'player' ? { position: [31.5, 0, 0] } : null),
        resolveEntityReference: () => null,
        prepareCanonicalChunkForMutation: async (cx, cy, cz) => {
          prepared.push(`${cx},${cy},${cz}`);
          return true;
        },
      },
      () => undefined,
      testCorePlatform.timers,
    );

    await expect(
      gate.prepareAction(
        {
          type: 'interact',
          intent: 'use',
          target: { kind: 'voxel', hit: [31, 0, 0], adjacent: [32, 0, 0] },
          expectedSelection: { inventoryRevision: 0, modeRevision: 0, creativeCatalogRevision: 0, selectedSlot: 0 },
        },
        'player',
      ),
    ).resolves.toBe(true);
    expect(prepared).toEqual(['0,0,0', '1,0,0']);
  });

  it('prepares an entity segment only for its current lifetime and interaction range', async () => {
    const prepared: string[] = [];
    let current = true;
    const gate = new AuthorityMutationPreparation(
      {
        worldRevision: 0,
        getEntity: (id) => (id === 'player' ? { position: [31, 0, 0] } : null),
        resolveEntityReference: (candidate) =>
          current && JSON.stringify(candidate) === JSON.stringify(reference) ? { position: [33, 0, 0] } : null,
        prepareCanonicalChunkForMutation: async (cx, cy, cz) => {
          prepared.push(`${cx},${cy},${cz}`);
          return true;
        },
      },
      () => undefined,
      testCorePlatform.timers,
    );
    const action = {
      type: 'interact' as const,
      intent: 'use' as const,
      target: { kind: 'entity' as const, reference },
      expectedSelection: { inventoryRevision: 0, modeRevision: 0, creativeCatalogRevision: 0, selectedSlot: 0 },
    };

    await expect(gate.prepareAction(action, 'player')).resolves.toBe(true);
    expect(prepared).toEqual(['0,0,0', '1,0,0']);
    prepared.length = 0;
    current = false;
    await expect(gate.prepareAction(action, 'player')).resolves.toBe(true);
    expect(prepared).toEqual([]);
  });

  it('prepares a bounded Structure footprint and support before re-resolving', async () => {
    const prepared: string[] = [];
    let calls = 0;
    const gate = new AuthorityMutationPreparation(
      {
        worldRevision: 0,
        getEntity: (id) => (id === 'player' ? { position: [31.5, 31, 0.5] } : null),
        resolveEntityReference: () => null,
        prepareCanonicalChunkForMutation: async (cx, cy, cz) => {
          prepared.push(`${cx},${cy},${cz}`);
          return true;
        },
      },
      () => undefined,
      testCorePlatform.timers,
      {
        prepare: () => {
          calls += 1;
          return calls === 1
            ? { status: 'unavailable', chunkKeys: ['0,0,0', '0,1,0'] }
            : {
                status: 'resolved',
                kind: 'existing',
                operation: 'toggle',
                target: [31, 31, 0] as const,
                chunkKeys: ['0,0,0', '0,1,0'],
                structure: {
                  definitionId: 'sample:panel',
                  stateId: 'closed',
                  source: 'registered',
                  root: [31, 31, 0],
                  parts: [],
                },
              };
        },
        prepareBreak: () => {
          throw new Error('Unexpected Structure break preparation.');
        },
      },
    );

    await expect(
      gate.prepareAction(
        {
          type: 'interact',
          intent: 'use',
          target: { kind: 'voxel', hit: [31, 31, 0], adjacent: [30, 31, 0] },
          expectedSelection: { inventoryRevision: 0, modeRevision: 0, creativeCatalogRevision: 0, selectedSlot: 0 },
        },
        'player',
      ),
    ).resolves.toBe(true);
    expect(calls).toBe(2);
    expect(prepared).toEqual(['0,0,0', '0,1,0']);
  });

  it('fails preparation when a candidate becomes non-Structure after loading its footprint', async () => {
    let calls = 0;
    const gate = new AuthorityMutationPreparation(
      {
        worldRevision: 0,
        getEntity: () => ({ position: [31.5, 31, 0.5] }),
        resolveEntityReference: () => null,
        prepareCanonicalChunkForMutation: async () => true,
      },
      () => undefined,
      testCorePlatform.timers,
      {
        prepare: () => (++calls === 1 ? { status: 'unavailable', chunkKeys: ['0,1,0'] } : { status: 'not-structure' }),
        prepareBreak: () => {
          throw new Error('Unexpected Structure break preparation.');
        },
      },
    );
    await expect(
      gate.prepareAction(
        {
          type: 'interact',
          intent: 'use',
          target: { kind: 'voxel', hit: [31, 31, 0], adjacent: [30, 31, 0] },
          expectedSelection: { inventoryRevision: 0, modeRevision: 0, creativeCatalogRevision: 0, selectedSlot: 0 },
        },
        'player',
      ),
    ).resolves.toBe(false);
    expect(calls).toBe(2);
  });
});
