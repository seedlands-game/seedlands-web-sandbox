export const behaviorUtf8Bytes = (text: string): number => {
  let total = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    total += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return total;
};

export const behaviorJsonBytes = (value: unknown): number => behaviorUtf8Bytes(JSON.stringify(value));

/** Counts a JSON array without allocating its complete serialized representation. */
export function boundedBehaviorJsonArrayBytes(values: readonly unknown[], maximum: number): number {
  let total = 2;
  for (let index = 0; index < values.length; index++) {
    total += (index === 0 ? 0 : 1) + behaviorJsonBytes(values[index]);
    if (total > maximum) return total;
  }
  return total;
}
