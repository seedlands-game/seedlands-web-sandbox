import { describe, expect, it, vi } from 'vitest';
import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';
import {
  createHarnessObservability,
  type HarnessObservabilityBindings,
} from '../../../src/app/gameplay/game-harness-observability';

const body = (id: string, x: number): AuthoritySnapshot['player'] => ({
  id,
  type: id === 'player' ? 'player' : 'creature',
  body: { position: { x, y: 31, z: 0 }, velocity: { x: 4.5, y: 0, z: 0 } },
  grounded: true,
  contacts: [],
});
const source = (): AuthoritySnapshot => {
  const player = body('player', 100);
  return {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'world:2',
    physicsTick: 42,
    commitSequence: 9,
    worldMutationCount: 0,
    acknowledgedInputSequence: 7,
    inputResyncRequired: false,
    activeTimeMs: 700,
    integratedPhysicsTimeMs: 700,
    physicsDebtMs: 0,
    player,
    entities: [player, body('sheep', 100.8)],
    chunkRevisions: {},
    worldRevision: 0,
    worldTime: 12,
    paused: false,
  };
};
const fixture = (initial = source()) => {
  let snapshot = initial;
  let ready = true;
  let epoch = 'world:2';
  const read = vi.fn(() => snapshot);
  const authority = {
    get isReady() {
      return ready;
    },
    get runtimeEpoch() {
      return epoch;
    },
    get snapshot() {
      return read();
    },
  };
  let current = authority;
  const bindings = {
    authority: () => current,
    renderedWorldEpoch: () => epoch,
  } as unknown as HarnessObservabilityBindings;
  const api = createHarnessObservability(bindings);
  return {
    api,
    read,
    initial,
    setSnapshot: (value: AuthoritySnapshot) => {
      snapshot = value;
    },
    setReady: (value: boolean) => {
      ready = value;
    },
    setEpoch: (value: string) => {
      epoch = value;
    },
    replace: () => {
      current = { ...authority };
    },
  };
};

describe('on-demand accepted Authority physics diagnostics', () => {
  it('preserves anonymous contacts with an explicit unknown collider identity', () => {
    const initial = source();
    const snapshot = {
      ...initial,
      player: { ...initial.player, contacts: [{ normal: { x: 1, y: 0, z: 0 }, point: { x: 100, y: 31, z: 0 } }] },
    };
    expect(fixture(snapshot).api.physicsDiagnostics()!.player.contacts.entries[0]!.colliderId).toBeNull();
  });

  it.each(['ready', 'epoch'] as const)('rejects %s changing during the read', (field) => {
    const f = fixture();
    f.read.mockImplementationOnce(() => {
      if (field === 'ready') f.setReady(false);
      else f.setEpoch('world:3');
      return f.initial;
    });
    expect(f.api.physicsDiagnostics()).toBeNull();
  });

  it('does not project during API creation and returns same-frontier detached frozen data', () => {
    const initial = source();
    const position = { x: 100, y: 31, z: 0 };
    const f = fixture({
      ...initial,
      player: {
        ...initial.player,
        body: { ...initial.player.body, position },
        contacts: [{ colliderId: 'voxel:100,30,0:0', normal: { x: 0, y: 1, z: 0 }, point: { x: 100, y: 31, z: 0 } }],
      },
    });
    expect(f.read).not.toHaveBeenCalled();
    const result = f.api.physicsDiagnostics();
    expect(result).toMatchObject({
      schemaVersion: 1,
      diagnosticOnly: true,
      epoch: 'world:2',
      physicsTick: 42,
      acknowledgedInputSequence: 7,
      player: {
        id: 'player',
        position: [100, 31, 0],
        velocity: [4.5, 0, 0],
        contacts: {
          count: 1,
          truncated: false,
          entries: [{ colliderId: 'voxel:100,30,0:0', normal: [0, 1, 0], point: [100, 31, 0] }],
        },
      },
      bodies: { entries: [{ id: 'sheep', position: [100.8, 31, 0] }] },
    });
    position.x = 999;
    expect(result!.player.position[0]).toBe(100);
    expect(Object.isFrozen(result!.player.position)).toBe(true);
    expect(Object.isFrozen(result!.player.contacts.entries[0]!.normal)).toBe(true);
    expect(Object.isFrozen(result!.bodies.entries[0]!.velocity)).toBe(true);
  });

  it('bounds contacts and body scanning/output and reports each truncation', () => {
    const initial = source();
    const player = {
      ...initial.player,
      contacts: Array.from({ length: 20 }, (_, i) => ({
        colliderId: 'contact-' + i,
        normal: { x: 1, y: 0, z: 0 },
        point: { x: 100, y: 31, z: 0 },
      })),
    };
    const s = {
      ...initial,
      player,
      entities: [
        player,
        ...Array.from({ length: 140 }, (_, i) => body('body-' + i.toString().padStart(3, '0'), 100 + i / 100)),
      ],
    };
    const result = fixture(s).api.physicsDiagnostics()!;
    expect(result.player.contacts).toMatchObject({ count: 20, truncated: true });
    expect(result.player.contacts.entries).toHaveLength(16);
    expect(result.bodies).toMatchObject({
      sourceCount: 141,
      scannedCount: 128,
      scanTruncated: true,
      nearbyCount: 127,
      truncated: true,
    });
    expect(result.bodies.entries).toHaveLength(8);
    expect(result.bodies.entries.map((b) => b.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => 'body-' + i.toString().padStart(3, '0')),
    );
  });

  it('rejects a snapshot from another epoch and a non-ready authority', () => {
    const f = fixture();
    f.setEpoch('world:3');
    expect(f.api.physicsDiagnostics()).toBeNull();
    f.setEpoch('world:2');
    f.setReady(false);
    expect(f.api.physicsDiagnostics()).toBeNull();
  });

  it('rejects same-epoch snapshot replacement while reading', () => {
    const f = fixture();
    f.read.mockImplementationOnce(() => {
      f.setSnapshot(source());
      return f.initial;
    });
    expect(f.api.physicsDiagnostics()).toBeNull();
  });

  it('rejects authority instance replacement while reading', () => {
    const f = fixture();
    f.read.mockImplementationOnce(() => {
      f.replace();
      return f.initial;
    });
    expect(f.api.physicsDiagnostics()).toBeNull();
  });
});
