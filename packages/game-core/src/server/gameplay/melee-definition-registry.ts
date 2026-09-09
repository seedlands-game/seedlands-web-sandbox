export type MeleeStepDefinition = Readonly<{
  damage: number;
  windupSeconds: number;
  hitSeconds: number;
  recoverySeconds: number;
}>;

export type MeleeDefinition = Readonly<{
  id: string;
  range: number;
  steps: readonly MeleeStepDefinition[];
}>;

const MAX_MELEE_DEFINITIONS = 64;
export const MAX_COMBO_STEPS = 8;

export type MeleeDefinitionRegistry = Readonly<{
  get: (id: string) => MeleeDefinition | undefined;
  list: () => readonly MeleeDefinition[];
}>;

export function createMeleeDefinitionRegistry(inputs: readonly MeleeDefinition[]): MeleeDefinitionRegistry {
  if (inputs.length > MAX_MELEE_DEFINITIONS) throw new TypeError('Melee definition registry exceeds its limit.');
  const registered = new Map<string, MeleeDefinition>();
  for (const input of inputs) {
    if (!input.id?.trim() || registered.has(input.id))
      throw new TypeError(`Duplicate or empty melee definition: ${input.id}`);
    if (
      !Number.isFinite(input.range) ||
      input.range <= 0 ||
      !Array.isArray(input.steps) ||
      input.steps.length === 0 ||
      input.steps.length > MAX_COMBO_STEPS
    )
      throw new TypeError(`Melee definition is invalid: ${input.id}`);
    const steps = input.steps.map((value) => {
      if (
        !Number.isFinite(value.damage) ||
        value.damage <= 0 ||
        !Number.isFinite(value.windupSeconds) ||
        value.windupSeconds < 0 ||
        !Number.isFinite(value.hitSeconds) ||
        value.hitSeconds <= 0 ||
        !Number.isFinite(value.recoverySeconds) ||
        value.recoverySeconds < 0
      )
        throw new TypeError(`Melee step is invalid: ${input.id}`);
      return Object.freeze({ ...value });
    });
    registered.set(input.id, Object.freeze({ id: input.id, range: input.range, steps: Object.freeze(steps) }));
  }
  const values = Object.freeze([...registered.values()]);
  return Object.freeze({ get: (id: string) => registered.get(id), list: () => values });
}
