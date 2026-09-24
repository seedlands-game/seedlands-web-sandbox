import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classicScenario } from './scenario';

describe('Classic canonical V1 scenario contract', () => {
  it('moves the complete canonical lane down by 29 blocks without changing its x/z route', () => {
    expect(classicScenario.initialState.floor).toEqual({ from: [-4, 30, -3], to: [224, 30, 3], voxel: 3 });
    expect(classicScenario.initialState.air).toEqual({ from: [-4, 31, -3], to: [224, 37, 3], voxel: 0 });
    expect(classicScenario.initialState.player).toEqual([0.5, 32.6, 0.5]);
    expect(classicScenario.initialState.resourceVoxels.map(({ position }) => position)).toEqual([
      [34, 31, 0],
      [38, 31, 0],
      [42, 31, 0],
      [45, 31, 0],
      [49, 31, 0],
    ]);
    expect(classicScenario.initialState.hostile.position).toEqual([56, 31, 0.5]);
    expect(classicScenario.route).toEqual({
      chunkCrossing: [33, 0.5],
      buildTarget: [52, 31, 0],
      stationTarget: [75, 31, 0],
      hostileApproach: [54, 0.5],
      stationApproach: [72.5, 0.5],
      farTurnaround: [208.5, 0.5],
      returnPoint: [72.5, 0.5],
    });
  });

  it('freezes a V1 slice whose two-cell door crosses the vertical Chunk boundary', () => {
    const slice = classicScenario.v1Slice;
    expect(slice).toEqual({
      water: { support: [68, 30, 2], target: [68, 31, 2], approach: [66, 2.5] },
      door: { support: [70, 30, 0], lower: [70, 31, 0], upper: [70, 32, 0], approach: [67.5, 0.5] },
      jukebox: { support: [76, 30, 2], target: [76, 31, 2], approach: [73.5, 2.5] },
    });
    expect(slice.door.support[1]).toBe(30);
    expect(slice.door.lower[1]).toBe(31);
    expect(slice.door.upper[1]).toBe(32);
    expect(slice.door.upper).toEqual([slice.door.lower[0], slice.door.lower[1] + 1, slice.door.lower[2]]);
    expect(Math.floor(slice.door.lower[1] / 32)).toBe(0);
    expect(Math.floor(slice.door.upper[1] / 32)).toBe(1);
    expect(slice.water.target[1]).toBe(31);
    expect(slice.jukebox.target[1]).toBe(31);
  });

  it('retains every canonical C0-C5 coverage stage', () => {
    const stages = new Set(
      classicScenario.coverage.integratedLegacyBrowserProtection.flatMap(
        ({ stages: protectedStages }) => protectedStages,
      ),
    );
    expect([...stages].sort()).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('keeps post-baseline V1 actions on product input instead of Harness mutation ports', () => {
    const specSource = readFileSync(new URL('../classic-runtime.spec.ts', import.meta.url), 'utf8');
    const helperSource = readFileSync(new URL('./v1-slice.ts', import.meta.url), 'utf8');
    const baselineOffset = specSource.indexOf('const baseline = await waitForSnapshot');
    expect(baselineOffset).toBeGreaterThan(0);
    const productJourney = `${specSource.slice(baselineOffset)}\n${helperSource}`;
    for (const forbidden of [
      '.fillWorld(',
      '.setVoxelAt(',
      "type: 'teleport'",
      "type: 'give-item'",
      "type: 'add-item'",
      "type: 'despawn-entity'",
      "type: 'remove-item'",
      "type: 'apply-damage'",
      "type: 'spawn-creature'",
      '.world.clock(',
      '.invokeActorModuleOperation(',
      'clearNaturalFixtureEntities(',
    ])
      expect(productJourney, `post-baseline journey contains ${forbidden}`).not.toContain(forbidden);
  });
});
