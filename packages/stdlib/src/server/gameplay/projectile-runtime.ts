export type ProjectileVector = Readonly<{ x: number; y: number; z: number }>;
export type ProjectileState = Readonly<{
  id: number;
  ownerId: string;
  position: ProjectileVector;
  velocity: ProjectileVector;
  damage: number;
  remainingSeconds: number;
}>;
export type ProjectileCheckpoint = Readonly<{ version: 1; nextId: number; projectiles: readonly ProjectileState[] }>;
export type ProjectileHit = Readonly<{ fraction: number; targetId?: string }>;
export type ProjectileEnvironment = Readonly<{
  firstVoxelHit: (from: ProjectileVector, to: ProjectileVector) => ProjectileHit | null;
  firstActorHit: (ownerId: string, from: ProjectileVector, to: ProjectileVector) => ProjectileHit | null;
  applyDamage: (ownerId: string, targetId: string, damage: number) => void;
}>;

const vector = (value: ProjectileVector, name: string): ProjectileVector => {
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new TypeError('Projectile ' + name + ' must be finite.');
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
};
const positive = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError('Projectile ' + name + ' must be positive.');
  return value;
};
const nonNegative = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) throw new TypeError('Projectile ' + name + ' must not be negative.');
  return value;
};
const normalized = (value: ProjectileVector) => {
  const checked = vector(value, 'direction');
  const length = Math.hypot(checked.x, checked.y, checked.z);
  if (length === 0) throw new TypeError('Projectile direction must not be zero.');
  return { x: checked.x / length, y: checked.y / length, z: checked.z / length };
};
const validHit = (value: ProjectileHit | null) => {
  if (value && (!Number.isFinite(value.fraction) || value.fraction < 0 || value.fraction > 1))
    throw new TypeError('Projectile hit fraction must be between zero and one.');
  return value;
};

export class ProjectileRuntime {
  readonly #environment: ProjectileEnvironment;
  #nextId: number;
  readonly #projectiles = new Map<number, ProjectileState>();
  constructor(environment: ProjectileEnvironment, checkpoint?: ProjectileCheckpoint) {
    this.#environment = environment;
    this.#nextId = checkpoint?.nextId ?? 1;
    if (!Number.isSafeInteger(this.#nextId) || this.#nextId < 1) throw new TypeError('Projectile next id is invalid.');
    if (checkpoint && checkpoint.version !== 1) throw new TypeError('Projectile checkpoint version is invalid.');
    for (const state of checkpoint?.projectiles ?? []) {
      if (
        !Number.isSafeInteger(state.id) ||
        state.id < 1 ||
        state.id >= this.#nextId ||
        this.#projectiles.has(state.id)
      )
        throw new TypeError('Projectile checkpoint identity is invalid.');
      if (!state.ownerId.trim()) throw new TypeError('Projectile owner is invalid.');
      this.#projectiles.set(
        state.id,
        Object.freeze({
          ...state,
          position: vector(state.position, 'position'),
          velocity: vector(state.velocity, 'velocity'),
          damage: nonNegative(state.damage, 'damage'),
          remainingSeconds: positive(state.remainingSeconds, 'lifetime'),
        }),
      );
    }
  }
  fire(
    input: Readonly<{
      ownerId: string;
      position: ProjectileVector;
      direction: ProjectileVector;
      speed: number;
      damage: number;
      lifetimeSeconds: number;
    }>,
  ): ProjectileState {
    if (!input.ownerId.trim()) throw new TypeError('Projectile owner is invalid.');
    const direction = normalized(input.direction);
    const speed = positive(input.speed, 'speed');
    const state = Object.freeze({
      id: this.#nextId++,
      ownerId: input.ownerId,
      position: vector(input.position, 'position'),
      velocity: Object.freeze({ x: direction.x * speed, y: direction.y * speed, z: direction.z * speed }),
      damage: nonNegative(input.damage, 'damage'),
      remainingSeconds: positive(input.lifetimeSeconds, 'lifetime'),
    });
    this.#projectiles.set(state.id, state);
    return state;
  }
  advance(deltaSeconds: number) {
    positive(deltaSeconds, 'advance');
    for (const state of [...this.#projectiles.values()].sort((a, b) => a.id - b.id)) {
      const to = Object.freeze({
        x: state.position.x + state.velocity.x * deltaSeconds,
        y: state.position.y + state.velocity.y * deltaSeconds,
        z: state.position.z + state.velocity.z * deltaSeconds,
      });
      const voxel = validHit(this.#environment.firstVoxelHit(state.position, to));
      const actor = validHit(this.#environment.firstActorHit(state.ownerId, state.position, to));
      if (voxel && (!actor || voxel.fraction <= actor.fraction)) {
        this.#projectiles.delete(state.id);
        continue;
      }
      if (actor?.targetId) {
        if (actor.targetId !== state.ownerId && state.damage > 0)
          this.#environment.applyDamage(state.ownerId, actor.targetId, state.damage);
        this.#projectiles.delete(state.id);
        continue;
      }
      const remainingSeconds = state.remainingSeconds - deltaSeconds;
      if (remainingSeconds <= 0) this.#projectiles.delete(state.id);
      else this.#projectiles.set(state.id, Object.freeze({ ...state, position: to, remainingSeconds }));
    }
  }
  list(): readonly ProjectileState[] {
    return Object.freeze([...this.#projectiles.values()].sort((a, b) => a.id - b.id));
  }
  checkpoint(): ProjectileCheckpoint {
    return Object.freeze({ version: 1, nextId: this.#nextId, projectiles: this.list() });
  }
  restore(checkpoint?: ProjectileCheckpoint): void {
    const restored = new ProjectileRuntime(this.#environment, checkpoint);
    this.#nextId = restored.#nextId;
    this.#projectiles.clear();
    for (const state of restored.#projectiles.values()) this.#projectiles.set(state.id, state);
  }
}
export const createProjectileRuntime = (environment: ProjectileEnvironment, checkpoint?: ProjectileCheckpoint) =>
  new ProjectileRuntime(environment, checkpoint);
