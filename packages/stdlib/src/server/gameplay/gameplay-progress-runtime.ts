export const GAMEPLAY_STATISTICS = [
  'blocks-mined',
  'blocks-placed',
  'items-crafted',
  'items-picked-up',
  'items-consumed',
  'actors-defeated',
  'distance-walked',
] as const;
export type GameplayStatistic = (typeof GAMEPLAY_STATISTICS)[number];
export type GameplayAchievement = 'first-block' | 'first-craft' | 'first-shelter' | 'first-hunt' | 'long-walk';
type PlayerProgress = Readonly<{
  playerId: string;
  statistics: Readonly<Partial<Record<GameplayStatistic, number>>>;
  achievements: readonly GameplayAchievement[];
}>;
export type GameplayProgressCheckpoint = Readonly<{ version: 1; players: readonly PlayerProgress[] }>;

const milestones: readonly Readonly<{
  id: GameplayAchievement;
  statistic: GameplayStatistic;
  threshold: number;
}>[] = [
  { id: 'first-block', statistic: 'blocks-mined', threshold: 1 },
  { id: 'first-craft', statistic: 'items-crafted', threshold: 1 },
  { id: 'first-shelter', statistic: 'blocks-placed', threshold: 8 },
  { id: 'first-hunt', statistic: 'actors-defeated', threshold: 1 },
  { id: 'long-walk', statistic: 'distance-walked', threshold: 100 },
];
const statisticSet = new Set<string>(GAMEPLAY_STATISTICS);
const achievementSet = new Set<string>(milestones.map(({ id }) => id));
const empty = (): GameplayProgressCheckpoint => ({ version: 1, players: [] });

export function validateGameplayProgressCheckpoint(value: GameplayProgressCheckpoint = empty()) {
  if (value.version !== 1 || !Array.isArray(value.players))
    throw new TypeError('Gameplay progress checkpoint is invalid.');
  const ids = new Set<string>();
  const players = value.players.map((entry) => {
    if (!entry.playerId?.trim() || ids.has(entry.playerId) || !entry.statistics || !Array.isArray(entry.achievements))
      throw new TypeError('Gameplay player progress is invalid.');
    ids.add(entry.playerId);
    const statistics: Partial<Record<GameplayStatistic, number>> = {};
    for (const [key, rawCount] of Object.entries(entry.statistics)) {
      if (typeof rawCount !== 'number' || !statisticSet.has(key) || !Number.isSafeInteger(rawCount) || rawCount < 0)
        throw new TypeError('Gameplay statistic is invalid.');
      statistics[key as GameplayStatistic] = rawCount;
    }
    if (
      new Set(entry.achievements).size !== entry.achievements.length ||
      entry.achievements.some((id: GameplayAchievement) => !achievementSet.has(id))
    )
      throw new TypeError('Gameplay achievement is invalid.');
    return Object.freeze({
      playerId: entry.playerId,
      statistics: Object.freeze(statistics),
      achievements: Object.freeze([...entry.achievements].sort()),
    });
  });
  return Object.freeze({
    version: 1 as const,
    players: Object.freeze(players.sort((a, b) => a.playerId.localeCompare(b.playerId))),
  });
}

export class GameplayProgressRuntime {
  readonly #players = new Map<string, PlayerProgress>();
  constructor(private readonly changed: () => void) {}

  record(playerId: string, statistic: GameplayStatistic, increment: number) {
    if (!playerId.trim() || !statisticSet.has(statistic) || !Number.isSafeInteger(increment) || increment <= 0)
      return { success: false as const, reason: 'invalid-progress' };
    const current = this.snapshot(playerId);
    const previous = current.statistics[statistic] ?? 0;
    if (previous > Number.MAX_SAFE_INTEGER - increment) return { success: false as const, reason: 'progress-overflow' };
    const statistics = { ...current.statistics, [statistic]: previous + increment };
    const achievements = new Set(current.achievements);
    const unlocked = milestones
      .filter(
        ({ id, statistic: key, threshold }) =>
          key === statistic && statistics[key]! >= threshold && !achievements.has(id),
      )
      .map(({ id }) => id);
    unlocked.forEach((id) => achievements.add(id));
    this.#players.set(playerId, { playerId, statistics, achievements: [...achievements].sort() });
    this.changed();
    return { success: true as const, unlocked: Object.freeze(unlocked) };
  }

  snapshot(playerId: string): PlayerProgress {
    const state = this.#players.get(playerId);
    return state
      ? { playerId: state.playerId, statistics: { ...state.statistics }, achievements: [...state.achievements] }
      : { playerId, statistics: Object.freeze({}), achievements: Object.freeze([]) };
  }

  checkpoint(): GameplayProgressCheckpoint {
    return validateGameplayProgressCheckpoint({ version: 1, players: [...this.#players.values()] });
  }

  restore(value?: GameplayProgressCheckpoint) {
    const checkpoint = validateGameplayProgressCheckpoint(value);
    this.#players.clear();
    checkpoint.players.forEach((entry) => this.#players.set(entry.playerId, entry));
  }
}
