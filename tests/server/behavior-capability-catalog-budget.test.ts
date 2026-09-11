import { describe, expect, it } from 'vitest';
import { BEHAVIOR_MAX_CATALOG_BYTES } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { isBehaviorCapabilityCatalog } from '@seedlands/game-core/runtime/behavior-capability-descriptor';
import { behaviorJsonBytes } from '@seedlands/game-core/runtime/behavior-json';
import { validCapabilities } from '../../apps/agent-server/src/node/resident-host-validation';
import { createMaximumBehaviorCatalog } from '../support/behavior-capability-catalog';

describe('behavior capability aggregate catalog budget', () => {
  it('publishes an exact 32 KiB catalog through the shared core and Agent boundary', () => {
    const catalog = createMaximumBehaviorCatalog();
    expect(behaviorJsonBytes(catalog)).toBe(BEHAVIOR_MAX_CATALOG_BYTES);
    expect(isBehaviorCapabilityCatalog(catalog)).toBe(true);
    expect(validCapabilities(catalog)).toBe(true);
  });

  it('rejects a one-byte-over catalog before registry freeze publishes it', () => {
    const catalog = createMaximumBehaviorCatalog();
    const adjustable = catalog.findIndex((entry) => entry.description.length < 512);
    expect(adjustable).toBeGreaterThanOrEqual(0);
    const oversized = catalog.map((entry, index) =>
      index === adjustable ? { ...entry, description: `${entry.description}x` } : entry,
    );
    expect(behaviorJsonBytes(oversized)).toBe(BEHAVIOR_MAX_CATALOG_BYTES + 1);
    expect(isBehaviorCapabilityCatalog(oversized)).toBe(false);
    expect(validCapabilities(oversized)).toBe(false);
    expect(() => createMaximumBehaviorCatalog(1)).toThrow(/catalog/i);
  });
});
