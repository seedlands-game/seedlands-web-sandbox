import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ create: vi.fn(() => ({ ready: true })) }));
vi.mock('@seedlands/stdlib/server/authority/authority-runtime', () => ({
  AuthorityRuntime: { create: runtime.create },
}));
vi.mock('../../../src/platform/core-platform', () => ({ browserCorePlatform: { now: () => 0 } }));

import { createBrowserAuthorityRuntime } from '../../../src/worker/authority-worldgen-runtime';
import { postAuthorityFatal } from '../../../src/worker/authority-worker-fatal';
import {
  LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN,
  LegacyGameplayProvenanceUnknownError,
} from '../../../src/client/persistence/legacy-gameplay-provenance-error';

const prepared = {
  assembly: {},
  worldgenProvider: {},
  starterEcology: null,
  voxelSemantics: [],
  voxelGeometry: undefined,
} as never;
const options = (snapshot: unknown, dispose = vi.fn()) =>
  ({
    epoch: 'browser',
    seedText: 'world',
    persistence: { loadGameplaySnapshot: () => snapshot, dispose },
    initialWorldTime: 9,
  }) as never;
const legacy = {
  version: 3,
  revision: 0,
  gameplayTime: 0,
  worldTime: 9,
  entitySequence: 0,
  entities: [],
  players: [],
  simulation: {},
  coordinateSchema: { version: 1, units: 'voxel', entityOrigin: 'body-feet-center' },
  physicsSchema: { version: 1, bodyRegistryVersion: 1 },
};

describe('Browser Authority legacy provenance gate', () => {
  beforeEach(() => runtime.create.mockClear());

  it('rejects unproven V1-V3 before constructing Authority', () => {
    const dispose = vi.fn();
    expect(() => createBrowserAuthorityRuntime(prepared, options(legacy, dispose))).toThrow(
      LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN,
    );
    expect(runtime.create).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps V4 and malformed snapshots on their existing validation path', () => {
    const dispose = vi.fn();
    expect(createBrowserAuthorityRuntime(prepared, options({ version: 4 }, dispose))).toEqual({
      ready: true,
    });
    expect(createBrowserAuthorityRuntime(prepared, options({ version: 3 }, dispose))).toEqual({
      ready: true,
    });
    expect(runtime.create).toHaveBeenCalledTimes(2);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('preserves the typed code through the existing fatal error channel', () => {
    const post = vi.fn();
    postAuthorityFatal(post, 'browser', new LegacyGameplayProvenanceUnknownError());
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'authority-fatal',
        error: expect.stringMatching(/^LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN:/u),
      }),
    );
  });
});
