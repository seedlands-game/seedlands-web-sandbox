import type { PlayerComponentAccess, createActorComponents } from './ecs-actor-components';
import type { BreakAction } from './player-state';
import { copyBreakAction } from './player-break-action-codec';

type Components = ReturnType<typeof createActorComponents>;
type Bindings = Readonly<{ resolve(): number }>;
const nonNegative = (value: number, field: string) => {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid actor ${field}.`);
  return value;
};
export const createPlayerComponentAccess = (components: Components, binding: Bindings) =>
  ({
    get spawnPosition(): [number, number, number] {
      const id = binding.resolve();
      return [components.player.spawnX[id]!, components.player.spawnY[id]!, components.player.spawnZ[id]!];
    },
    set spawnPosition(value: [number, number, number]) {
      if (value.length !== 3 || !value.every(Number.isFinite)) throw new TypeError('Invalid player spawn position.');
      const id = binding.resolve();
      [components.player.spawnX[id], components.player.spawnY[id], components.player.spawnZ[id]] = value;
    },
    get hungerAccumulator() {
      return components.needs.hungerAccumulator[binding.resolve()]!;
    },
    set hungerAccumulator(value: number) {
      components.needs.hungerAccumulator[binding.resolve()] = nonNegative(value, 'hunger accumulator');
    },
    get healingAccumulator() {
      return components.needs.healingAccumulator[binding.resolve()]!;
    },
    set healingAccumulator(value: number) {
      components.needs.healingAccumulator[binding.resolve()] = nonNegative(value, 'healing accumulator');
    },
    get starvationAccumulator() {
      return components.needs.starvationAccumulator[binding.resolve()]!;
    },
    set starvationAccumulator(value: number) {
      components.needs.starvationAccumulator[binding.resolve()] = nonNegative(value, 'starvation accumulator');
    },
    get breakAction() {
      return copyBreakAction(components.player.breakAction[binding.resolve()]);
    },
    set breakAction(value: BreakAction | null) {
      components.player.breakAction[binding.resolve()] = copyBreakAction(value);
    },
  }) satisfies Omit<PlayerComponentAccess, keyof import('./ecs-actor-components').ActorComponentAccess>;
