import { describe, expect, it } from 'vitest';
import {
  buildStructureTransitionCandidateV1,
  createStructureDefinitionRegistryV1,
  resolveStructureRootV1,
  transitionStructureStateV1,
} from '@seedlands/stdlib/mod-api';
import {
  CLASSIC_LEGACY_MAX_VOXEL_STORAGE_ID,
  CLASSIC_WOODEN_DOOR_FIRST_VARIANT_STORAGE_ID,
  CLASSIC_WOODEN_DOOR_LAST_VARIANT_STORAGE_ID,
  CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID,
  classicStructureDefinitionModule,
  classicWoodenDoorDefinition,
  classicWoodenDoorLegacyCompatibility,
  classicWoodenDoorOrientations,
  classicWoodenDoorVariants,
} from '../src/structures';

describe('Classic wooden door declaration', () => {
  it('uses exactly sixteen stable append-only IDs above the frozen legacy palette', () => {
    const ids = classicWoodenDoorVariants.map(({ storageId }) => storageId);
    expect(CLASSIC_LEGACY_MAX_VOXEL_STORAGE_ID).toBe(88);
    expect(CLASSIC_WOODEN_DOOR_FIRST_VARIANT_STORAGE_ID).toBe(89);
    expect(CLASSIC_WOODEN_DOOR_LAST_VARIANT_STORAGE_ID).toBe(104);
    expect(ids).toEqual(Array.from({ length: 16 }, (_, index) => 89 + index));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id > CLASSIC_LEGACY_MAX_VOXEL_STORAGE_ID)).toBe(true);
    expect(ids).not.toContain(CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID);
  });

  it('declares lower and upper variants for closed/open in all four horizontal orientations', () => {
    expect(classicWoodenDoorOrientations).toEqual(['north', 'east', 'south', 'west']);
    for (const orientation of classicWoodenDoorOrientations)
      for (const open of [false, true]) {
        const variants = classicWoodenDoorVariants.filter(
          (candidate) => candidate.orientation === orientation && candidate.open === open,
        );
        expect(variants.map(({ role }) => role).sort()).toEqual(['lower', 'upper']);
        const state = classicWoodenDoorDefinition.states.find(
          ({ id }) => id === `${orientation}-${open ? 'open' : 'closed'}`,
        );
        expect(state?.variants).toEqual(Object.fromEntries(variants.map(({ role, storageId }) => [role, storageId])));
      }
  });

  it('keeps lower as the root and defines a bidirectional toggle for every orientation', () => {
    expect(classicWoodenDoorDefinition.parts).toEqual([
      { role: 'lower', offset: [0, 0, 0] },
      { role: 'upper', offset: [0, 1, 0] },
    ]);
    expect(classicWoodenDoorDefinition.rootRole).toBe('lower');
    expect(classicWoodenDoorDefinition.initialState).toBe('north-closed');
    for (const orientation of classicWoodenDoorOrientations) {
      expect(transitionStructureStateV1(classicWoodenDoorDefinition, `${orientation}-closed`, 'toggle')).toBe(
        `${orientation}-open`,
      );
      expect(transitionStructureStateV1(classicWoodenDoorDefinition, `${orientation}-open`, 'toggle')).toBe(
        `${orientation}-closed`,
      );
    }
  });

  it('keeps storage ID 52 as an explicit default-closed legacy mapping without reinterpreting it', () => {
    expect(classicWoodenDoorLegacyCompatibility).toEqual({
      storageId: 52,
      definitionId: 'seedlands:wooden-door',
      defaultStateId: 'north-closed',
      rootRole: 'lower',
      pairedRole: 'upper',
      pairedOffset: [0, 1, 0],
      requiresUniqueVerticalPair: true,
    });
    const registry = createStructureDefinitionRegistryV1([classicWoodenDoorDefinition]);
    expect(registry.resolveVariant(52)).toBeUndefined();
    for (const variant of classicWoodenDoorVariants)
      expect(registry.resolveVariant(variant.storageId)).toMatchObject({
        definition: { id: 'seedlands:wooden-door' },
        stateId: variant.stateId,
        role: variant.role,
      });
    const legacyCells = new Map([
      ['1,31,0', 52],
      ['1,32,0', 52],
    ]);
    const read = ([x, y, z]: readonly [number, number, number]) => legacyCells.get(`${x},${y},${z}`);
    expect(resolveStructureRootV1(classicWoodenDoorDefinition, [1, 32, 0], read)).toMatchObject({
      stateId: 'north-closed',
      source: 'legacy',
      root: [1, 31, 0],
    });
    const lower = registry.resolveTarget([1, 31, 0], read);
    const upper = registry.resolveTarget([1, 32, 0], read);
    expect(lower).toMatchObject({
      definitionId: 'seedlands:wooden-door',
      stateId: 'north-closed',
      source: 'legacy',
      root: [1, 31, 0],
    });
    expect(upper).toMatchObject({
      definitionId: 'seedlands:wooden-door',
      stateId: 'north-closed',
      source: 'legacy',
      root: [1, 31, 0],
    });
    if (!lower || !upper) throw new Error('Expected both legacy door halves to resolve.');
    for (const current of [lower, upper])
      expect(
        buildStructureTransitionCandidateV1(classicWoodenDoorDefinition, {
          current,
          transitionId: 'toggle',
          read,
        }).edits.map(({ from, to }) => [from, to]),
      ).toEqual([
        [52, 91],
        [52, 92],
      ]);
  });

  it('registers only the frozen Structure capability module with no item or operation ownership', () => {
    expect(classicStructureDefinitionModule.descriptor).toEqual({
      id: 'seedlands:overworld-structures',
      version: '1.0.0',
      requires: [
        { id: 'seedlands:items', version: '1.0.0' },
        { id: 'seedlands:voxel-semantics', version: '1.0.0' },
        { id: 'seedlands:voxel-geometry', version: '1.0.0' },
      ],
      provides: [{ id: 'seedlands:structure-definitions', version: '1.0.0' }],
    });
  });
});
