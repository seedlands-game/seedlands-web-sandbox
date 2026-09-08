import { expect, it } from 'vitest';
import {
  meleeShowcaseCommands,
  MELEE_SHOWCASE_DUMMY_IDS,
  MELEE_SHOWCASE_ENTITY_IDS,
  MELEE_SHOWCASE_HOSTILE_ID,
} from '../../apps/web/src/app/gameplay/melee-action-showcase';

it('体验场只清理固定目标并在夜间确定性重建三只静止目标与一只真实敌人', () => {
  const commands = meleeShowcaseCommands(new Set([MELEE_SHOWCASE_DUMMY_IDS[1], 'unrelated-creature']));
  expect(commands[0]).toEqual({ type: 'despawn-entity', entityId: MELEE_SHOWCASE_DUMMY_IDS[1] });
  expect(commands).not.toContainEqual({ type: 'despawn-entity', entityId: 'unrelated-creature' });
  expect(commands.filter((command) => command.type === 'spawn-creature').map((command) => command.id)).toEqual([
    ...MELEE_SHOWCASE_DUMMY_IDS,
  ]);
  expect(commands).toContainEqual(
    expect.objectContaining({ type: 'spawn-actor', id: MELEE_SHOWCASE_HOSTILE_ID, archetype: 'night-stalker' }),
  );
  expect(new Set(MELEE_SHOWCASE_ENTITY_IDS).size).toBe(4);
  expect(commands).toContainEqual({ type: 'time-set', hours: 22 });
  expect(commands).toContainEqual({ type: 'teleport', position: [0.5, 57, 0.5] });
  expect(commands).toContainEqual({ type: 'heal', amount: 20 });
});
