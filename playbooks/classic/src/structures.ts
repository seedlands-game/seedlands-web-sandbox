import {
  defineStructureDefinitionModule,
  defineStructureDefinitionV1,
  type StructureDefinitionV1,
} from '@seedlands/stdlib/mod-api';

export const CLASSIC_LEGACY_MAX_VOXEL_STORAGE_ID = 88;
export const CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID = 52;
export const CLASSIC_WOODEN_DOOR_FIRST_VARIANT_STORAGE_ID = 89;
export const CLASSIC_WOODEN_DOOR_LAST_VARIANT_STORAGE_ID = 104;

export const classicWoodenDoorOrientations = Object.freeze(['north', 'east', 'south', 'west'] as const);
export type ClassicWoodenDoorOrientation = (typeof classicWoodenDoorOrientations)[number];
export type ClassicWoodenDoorRole = 'lower' | 'upper';

export const classicWoodenDoorClosedStateForBearing = (bearing: ClassicWoodenDoorOrientation): string => {
  if (!classicWoodenDoorOrientations.includes(bearing)) throw new TypeError('Classic wooden door bearing is invalid.');
  return `${bearing}-closed`;
};

export type ClassicWoodenDoorVariant = Readonly<{
  storageId: number;
  orientation: ClassicWoodenDoorOrientation;
  open: boolean;
  role: ClassicWoodenDoorRole;
  stateId: string;
}>;

const doorVariantStorageId = (orientationIndex: number, open: boolean, role: ClassicWoodenDoorRole): number =>
  CLASSIC_WOODEN_DOOR_FIRST_VARIANT_STORAGE_ID + orientationIndex * 4 + Number(open) * 2 + Number(role === 'upper');

export const classicWoodenDoorVariants: readonly ClassicWoodenDoorVariant[] = Object.freeze(
  classicWoodenDoorOrientations.flatMap((orientation, orientationIndex) =>
    ([false, true] as const).flatMap((open) => {
      const stateId = `${orientation}-${open ? 'open' : 'closed'}`;
      return (['lower', 'upper'] as const).map((role) =>
        Object.freeze({
          storageId: doorVariantStorageId(orientationIndex, open, role),
          orientation,
          open,
          role,
          stateId,
        }),
      );
    }),
  ),
);

const variantFor = (orientation: ClassicWoodenDoorOrientation, open: boolean, role: ClassicWoodenDoorRole): number => {
  const variant = classicWoodenDoorVariants.find(
    (candidate) => candidate.orientation === orientation && candidate.open === open && candidate.role === role,
  );
  if (!variant) throw new Error(`Classic wooden door variant is missing: ${orientation}/${String(open)}/${role}`);
  return variant.storageId;
};

export const classicWoodenDoorDefinition: StructureDefinitionV1 = defineStructureDefinitionV1({
  version: 1,
  id: 'seedlands:wooden-door',
  rootRole: 'lower',
  initialState: 'north-closed',
  parts: [
    { role: 'lower', offset: [0, 0, 0] },
    { role: 'upper', offset: [0, 1, 0] },
  ],
  states: classicWoodenDoorOrientations.flatMap((orientation) =>
    ([false, true] as const).map((open) => ({
      id: `${orientation}-${open ? 'open' : 'closed'}`,
      variants: {
        lower: variantFor(orientation, open, 'lower'),
        upper: variantFor(orientation, open, 'upper'),
      },
      collision: {
        lower: open ? ('passable' as const) : ('blocking' as const),
        upper: open ? ('passable' as const) : ('blocking' as const),
      },
    })),
  ),
  transitions: classicWoodenDoorOrientations.flatMap((orientation) => [
    { id: 'toggle', from: `${orientation}-closed`, to: `${orientation}-open` },
    { id: 'toggle', from: `${orientation}-open`, to: `${orientation}-closed` },
  ]),
  legacyStates: [
    {
      stateId: 'north-closed',
      variants: { lower: CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID, upper: CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID },
    },
  ],
  support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' },
  variantDescriptorKind: 'registered-structure',
  placementItemId: 'seedlands:wooden-door',
  dropOwnerRole: 'lower',
  drop: { itemId: 'seedlands:wooden-door', count: 1 },
});

export const classicWoodenDoorLegacyCompatibility = Object.freeze({
  storageId: CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID,
  definitionId: classicWoodenDoorDefinition.id,
  defaultStateId: 'north-closed',
  rootRole: 'lower' as const,
  pairedRole: 'upper' as const,
  pairedOffset: Object.freeze([0, 1, 0] as const),
  requiresUniqueVerticalPair: true,
});

export const classicStructureDefinitions = Object.freeze([classicWoodenDoorDefinition]);
export const classicStructureDefinitionModule = defineStructureDefinitionModule({
  moduleId: 'seedlands:overworld-structures',
  definitions: classicStructureDefinitions,
});
