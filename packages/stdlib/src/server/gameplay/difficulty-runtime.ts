export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export type DifficultyCheckpoint = Readonly<{ version: 1; value: Difficulty; revision: number }>;

const values: readonly Difficulty[] = ['peaceful', 'easy', 'normal', 'hard'];
export class DifficultyRuntime {
  #value: Difficulty;
  #revision: number;
  constructor(checkpoint: DifficultyCheckpoint = { version: 1, value: 'normal', revision: 0 }) {
    if (
      checkpoint.version !== 1 ||
      !values.includes(checkpoint.value) ||
      !Number.isSafeInteger(checkpoint.revision) ||
      checkpoint.revision < 0
    )
      throw new TypeError('Difficulty checkpoint is invalid.');
    this.#value = checkpoint.value;
    this.#revision = checkpoint.revision;
  }
  get value() {
    return this.#value;
  }
  damage(base: number) {
    if (!Number.isFinite(base) || base < 0) throw new TypeError('Difficulty damage must be non-negative.');
    return base * ({ peaceful: 0, easy: 0.5, normal: 1, hard: 1.5 } as const)[this.#value];
  }
  set(value: Difficulty, expectedRevision = this.#revision) {
    if (!values.includes(value)) throw new TypeError('Difficulty is invalid.');
    if (expectedRevision !== this.#revision) return { success: false as const, reason: 'stale-revision' };
    if (value === this.#value) return { success: true as const, changed: false, checkpoint: this.checkpoint() };
    this.#value = value;
    this.#revision += 1;
    return { success: true as const, changed: true, checkpoint: this.checkpoint() };
  }
  checkpoint(): DifficultyCheckpoint {
    return Object.freeze({ version: 1, value: this.#value, revision: this.#revision });
  }
  restore(checkpoint?: DifficultyCheckpoint) {
    const restored = new DifficultyRuntime(checkpoint);
    this.#value = restored.#value;
    this.#revision = restored.#revision;
  }
}
export const createDifficultyRuntime = (checkpoint?: DifficultyCheckpoint) => new DifficultyRuntime(checkpoint);

export const hostileActorsForPeaceful = (
  actors: readonly Readonly<{ id: string; disposition?: string; tamed?: boolean }>[],
) =>
  Object.freeze(
    actors
      .filter((actor) => actor.disposition === 'hostile' && actor.tamed !== true)
      .map((actor) => actor.id)
      .sort(),
  );
