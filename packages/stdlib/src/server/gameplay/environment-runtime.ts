export type WeatherKind = 'clear' | 'rain' | 'thunder';
export type EnvironmentPosition = readonly [number, number, number];
export type EnvironmentCheckpoint = Readonly<{
  version: 1;
  seed: number;
  tick: number;
  weather: WeatherKind;
  weatherSeconds: number;
  fires: readonly Readonly<{ position: EnvironmentPosition; remainingSeconds: number }>[];
  tnt: readonly Readonly<{ id: number; position: EnvironmentPosition; fuseSeconds: number; power: number }>[];
  nextTntId: number;
  dungeonSpawners?: readonly Readonly<{ id: string; elapsedSeconds: number; activations: number }>[];
  openedDungeonChests?: readonly string[];
}>;
export type EnvironmentEffects = Readonly<{
  extinguished: readonly EnvironmentPosition[];
  ignited: readonly EnvironmentPosition[];
  explosions: readonly Readonly<{
    id: number;
    position: EnvironmentPosition;
    power: number;
    blocks: readonly EnvironmentPosition[];
  }>[];
}>;

const key = (p: EnvironmentPosition) => p.join(',');
const position = (p: EnvironmentPosition): EnvironmentPosition => {
  if (p.length !== 3 || !p.every(Number.isFinite)) throw new TypeError('Environment position is invalid.');
  return Object.freeze([p[0], p[1], p[2]] as const);
};
const hash = (seed: number, tick: number) => Math.imul((seed ^ tick) >>> 0, 0x45d9f3b) >>> 0;

export class EnvironmentRuntime {
  #tick = 0;
  #weather: WeatherKind = 'clear';
  #weatherSeconds = 300;
  #nextTntId = 1;
  readonly #fires = new Map<string, { position: EnvironmentPosition; remainingSeconds: number }>();
  readonly #tnt = new Map<number, { id: number; position: EnvironmentPosition; fuseSeconds: number; power: number }>();
  readonly #dungeonSpawners = new Map<string, { elapsedSeconds: number; activations: number }>();
  readonly #openedDungeonChests = new Set<string>();
  constructor(
    readonly seed: number,
    checkpoint?: EnvironmentCheckpoint,
  ) {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new TypeError('Environment seed is invalid.');
    if (checkpoint) this.restore(checkpoint);
  }
  ignite(at: EnvironmentPosition, seconds = 30) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Fire lifetime is invalid.');
    const p = position(at);
    this.#fires.set(key(p), { position: p, remainingSeconds: seconds });
  }
  primeTnt(at: EnvironmentPosition, fuseSeconds = 4, power = 4) {
    if (![fuseSeconds, power].every((v) => Number.isFinite(v) && v > 0))
      throw new TypeError('TNT parameters are invalid.');
    const value = { id: this.#nextTntId++, position: position(at), fuseSeconds, power };
    this.#tnt.set(value.id, value);
    return Object.freeze({ ...value });
  }
  setWeather(weather: WeatherKind, seconds: number) {
    if (!['clear', 'rain', 'thunder'].includes(weather) || !Number.isFinite(seconds) || seconds <= 0)
      throw new TypeError('Weather is invalid.');
    this.#weather = weather;
    this.#weatherSeconds = seconds;
  }
  advanceDungeonSpawner(id: string, seconds: number, intervalSeconds = 20) {
    if (!id.trim() || ![seconds, intervalSeconds].every((value) => Number.isFinite(value) && value > 0))
      throw new TypeError('Dungeon spawner advance is invalid.');
    const state = this.#dungeonSpawners.get(id) ?? { elapsedSeconds: 0, activations: 0 };
    state.elapsedSeconds += seconds;
    if (state.elapsedSeconds < intervalSeconds) {
      this.#dungeonSpawners.set(id, state);
      return null;
    }
    state.elapsedSeconds %= intervalSeconds;
    state.activations += 1;
    this.#dungeonSpawners.set(id, state);
    return state.activations;
  }
  isDungeonChestOpened(id: string) {
    if (!id.trim()) throw new TypeError('Dungeon chest identity is invalid.');
    return this.#openedDungeonChests.has(id);
  }
  markDungeonChestOpened(id: string) {
    if (this.isDungeonChestOpened(id)) return false;
    this.#openedDungeonChests.add(id);
    return true;
  }
  advance(
    seconds: number,
    world: Readonly<{ flammable(at: EnvironmentPosition): boolean; skyVisible(at: EnvironmentPosition): boolean }>,
  ): EnvironmentEffects {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Environment advance is invalid.');
    this.#tick++;
    this.#weatherSeconds -= seconds;
    if (this.#weatherSeconds <= 0) {
      const n = hash(this.seed, this.#tick) % 10;
      this.#weather = n < 6 ? 'clear' : n < 9 ? 'rain' : 'thunder';
      this.#weatherSeconds = 120 + (hash(this.seed ^ 0x57, this.#tick) % 181);
    }
    const extinguished: EnvironmentPosition[] = [];
    const ignited: EnvironmentPosition[] = [];
    for (const [id, fire] of [...this.#fires].sort()) {
      fire.remainingSeconds -= seconds;
      if (fire.remainingSeconds <= 0 || (this.#weather !== 'clear' && world.skyVisible(fire.position))) {
        this.#fires.delete(id);
        extinguished.push(fire.position);
        continue;
      }
      if (this.#tick % 4 === 0)
        for (const offset of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 0, 1],
          [0, 0, -1],
        ] as const) {
          const at = position([fire.position[0] + offset[0], fire.position[1], fire.position[2] + offset[2]]);
          if (world.flammable(at) && !this.#fires.has(key(at))) {
            this.#fires.set(key(at), { position: at, remainingSeconds: 20 });
            ignited.push(at);
            break;
          }
        }
    }
    const explosions = [] as {
      id: number;
      position: EnvironmentPosition;
      power: number;
      blocks: EnvironmentPosition[];
    }[];
    for (const [id, tnt] of [...this.#tnt].sort((a, b) => a[0] - b[0])) {
      tnt.fuseSeconds -= seconds;
      if (tnt.fuseSeconds > 0) continue;
      this.#tnt.delete(id);
      const blocks: EnvironmentPosition[] = [];
      const r = Math.ceil(tnt.power);
      for (let x = -r; x <= r; x++)
        for (let y = -r; y <= r; y++)
          for (let z = -r; z <= r; z++)
            if (x * x + y * y + z * z <= tnt.power * tnt.power)
              blocks.push(position([tnt.position[0] + x, tnt.position[1] + y, tnt.position[2] + z]));
      explosions.push({ id, position: tnt.position, power: tnt.power, blocks });
    }
    return Object.freeze({
      extinguished: Object.freeze(extinguished),
      ignited: Object.freeze(ignited),
      explosions: Object.freeze(explosions.map((x) => Object.freeze({ ...x, blocks: Object.freeze(x.blocks) }))),
    });
  }
  checkpoint(): EnvironmentCheckpoint {
    return Object.freeze({
      version: 1,
      seed: this.seed,
      tick: this.#tick,
      weather: this.#weather,
      weatherSeconds: this.#weatherSeconds,
      fires: Object.freeze([...this.#fires.values()].map((x) => Object.freeze({ ...x }))),
      tnt: Object.freeze([...this.#tnt.values()].map((x) => Object.freeze({ ...x }))),
      nextTntId: this.#nextTntId,
      dungeonSpawners: Object.freeze(
        [...this.#dungeonSpawners]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, state]) => Object.freeze({ id, ...state })),
      ),
      openedDungeonChests: Object.freeze([...this.#openedDungeonChests].sort()),
    });
  }
  restore(value: EnvironmentCheckpoint) {
    if (
      value.version !== 1 ||
      value.seed !== this.seed ||
      !Number.isSafeInteger(value.tick) ||
      value.tick < 0 ||
      !['clear', 'rain', 'thunder'].includes(value.weather) ||
      !Number.isFinite(value.weatherSeconds) ||
      value.weatherSeconds <= 0
    )
      throw new TypeError('Environment checkpoint is invalid.');
    this.#tick = value.tick;
    this.#weather = value.weather;
    this.#weatherSeconds = value.weatherSeconds;
    this.#nextTntId = value.nextTntId;
    this.#fires.clear();
    this.#tnt.clear();
    this.#dungeonSpawners.clear();
    this.#openedDungeonChests.clear();
    for (const fire of value.fires) this.ignite(fire.position, fire.remainingSeconds);
    for (const tnt of value.tnt) {
      if (tnt.id >= this.#nextTntId || this.#tnt.has(tnt.id))
        throw new TypeError('TNT checkpoint identity is invalid.');
      this.#tnt.set(tnt.id, { ...tnt, position: position(tnt.position) });
    }
    for (const state of value.dungeonSpawners ?? []) {
      if (
        !state.id?.trim() ||
        this.#dungeonSpawners.has(state.id) ||
        !Number.isFinite(state.elapsedSeconds) ||
        state.elapsedSeconds < 0 ||
        !Number.isSafeInteger(state.activations) ||
        state.activations < 0
      )
        throw new TypeError('Dungeon spawner checkpoint is invalid.');
      this.#dungeonSpawners.set(state.id, { elapsedSeconds: state.elapsedSeconds, activations: state.activations });
    }
    for (const id of value.openedDungeonChests ?? []) {
      if (typeof id !== 'string' || !id.trim() || this.#openedDungeonChests.has(id))
        throw new TypeError('Dungeon chest checkpoint is invalid.');
      this.#openedDungeonChests.add(id);
    }
  }
}
