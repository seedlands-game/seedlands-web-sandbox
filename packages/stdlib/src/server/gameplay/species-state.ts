import type { EcsActorArchetype } from './ecs-entity-owner';

export const WOOL_COLORS = [
  'white',
  'orange',
  'magenta',
  'light-blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light-gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;
export type WoolColor = (typeof WOOL_COLORS)[number];
export type SpeciesStateV1 = Readonly<{
  version: 1;
  sheared: boolean;
  woolColor: WoolColor;
  tamedBy: string | null;
  sitting: boolean;
  saddled: boolean;
  tameAttempts: number;
  slimeSize: 1 | 2 | 4;
}>;

export const defaultSpeciesState = (archetype?: EcsActorArchetype): SpeciesStateV1 | null =>
  archetype && ['sheep', 'wolf', 'pig', 'slime'].includes(archetype)
    ? Object.freeze({
        version: 1,
        sheared: false,
        woolColor: 'white',
        tamedBy: null,
        sitting: false,
        saddled: false,
        tameAttempts: 0,
        slimeSize: archetype === 'slime' ? 4 : 1,
      })
    : null;

export function validateSpeciesState(value: unknown): SpeciesStateV1 | null {
  if (value === undefined || value === null) return null;
  const state = value as Partial<SpeciesStateV1>;
  if (
    state.version !== 1 ||
    typeof state.sheared !== 'boolean' ||
    !WOOL_COLORS.includes(state.woolColor as WoolColor) ||
    (state.tamedBy !== null && (typeof state.tamedBy !== 'string' || !state.tamedBy.trim())) ||
    typeof state.sitting !== 'boolean' ||
    typeof state.saddled !== 'boolean' ||
    !Number.isSafeInteger(state.tameAttempts) ||
    state.tameAttempts! < 0 ||
    ![1, 2, 4].includes(state.slimeSize!)
  )
    throw new TypeError('Species state is invalid.');
  if (state.sitting && !state.tamedBy) throw new TypeError('Untamed species cannot sit.');
  return Object.freeze({ ...state } as SpeciesStateV1);
}

export const createSpeciesStateAccess = (read: () => unknown, write: (value: SpeciesStateV1 | undefined) => void) => ({
  get species() {
    return validateSpeciesState(read());
  },
  replaceSpecies(value: SpeciesStateV1 | null) {
    write(validateSpeciesState(value) ?? undefined);
  },
});
