import { expect, it, vi } from 'vitest';
import { PointerAttackInputPump } from '../../../src/worker/pointer-attack-input-pump';
import type { PointerAttackInput } from '../../../src/client/authority/pointer-attack-protocol';

function driver() {
  let actor = { reference: { entityId: 'player', epoch: 1, lifetime: 1 }, mode: 'survival' };
  const attack = vi.fn(async () => null);
  const pump = new PointerAttackInputPump({ actor: () => actor, attack });
  const input = (
    sequence: number,
    gesture = 1,
    direction: PointerAttackInput['direction'] = [0, 0, -1],
    time = 1000,
  ) => ({ sequence, gesture, direction, capturedAtTimeOriginMs: time });
  return {
    pump,
    attack,
    input,
    replace: (replacement: typeof actor) => {
      actor = replacement;
    },
    actor: () => actor,
  };
}

it('a release cannot be undone by duplicated or reordered held input', async () => {
  const d = driver();
  expect(d.pump.accept(d.input(0), 1000)).toBe(true);
  await d.pump.service(1000);
  expect(d.pump.accept(d.input(2, 1, null), 1050)).toBe(true);
  expect(d.pump.accept(d.input(1), 1050)).toBe(false);
  expect(d.pump.accept(d.input(3), 1050)).toBe(false);
  await d.pump.service(1300);
  expect(d.attack).toHaveBeenCalledTimes(1);
  expect(d.pump.accept(d.input(4, 2), 1300)).toBe(true);
  await d.pump.service(1300);
  expect(d.attack).toHaveBeenCalledTimes(2);
});

it('expired gestures require a fresh mouse-down and never catch up in a burst', async () => {
  const d = driver();
  d.pump.accept(d.input(0), 1000);
  await d.pump.service(1000);
  await d.pump.service(1900);
  await d.pump.service(1900);
  expect(d.attack).toHaveBeenCalledTimes(2);
  await d.pump.service(3000);
  expect(d.pump.accept(d.input(1, 1, [0, 0, -1], 3000), 3000)).toBe(false);
  expect(d.pump.accept(d.input(2, 2, [0, 0, -1], 3000), 3000)).toBe(true);
  await d.pump.service(3000);
  expect(d.attack).toHaveBeenCalledTimes(3);
});

it('a queued renewal cannot revive an expired gesture before the next worker service', async () => {
  const d = driver();
  d.pump.accept(d.input(0), 1000);
  await d.pump.service(1000);
  expect(d.pump.accept(d.input(1, 1, [0, 0, -1], 3000), 3000)).toBe(false);
  await d.pump.service(3000);
  expect(d.attack).toHaveBeenCalledTimes(1);
  expect(d.pump.accept(d.input(2, 2, [0, 0, -1], 3000), 3000)).toBe(true);
  await d.pump.service(3000);
  expect(d.attack).toHaveBeenCalledTimes(2);
});

it.each(['mode', 'lifetime', 'epoch'] as const)('canonical %s replacement retires the held gesture', async (field) => {
  const d = driver();
  d.pump.accept(d.input(0), 1000);
  await d.pump.service(1000);
  const actor = d.actor();
  d.replace(
    field === 'mode' ? { ...actor, mode: 'creative' } : { ...actor, reference: { ...actor.reference, [field]: 2 } },
  );
  await d.pump.service(1200);
  expect(d.pump.accept(d.input(1), 1200)).toBe(false);
  expect(d.attack).toHaveBeenCalledTimes(1);
});

it('pause and resume both retire intent instead of replaying a held gesture', async () => {
  const d = driver();
  d.pump.accept(d.input(0), 1000);
  d.pump.suspend(true);
  await d.pump.service(1200);
  expect(d.pump.accept(d.input(1), 1200)).toBe(false);
  d.pump.suspend(false);
  expect(d.pump.accept(d.input(2), 1200)).toBe(false);
  expect(d.pump.accept(d.input(3, 2), 1200)).toBe(true);
  await d.pump.service(1200);
  expect(d.attack).toHaveBeenCalledTimes(1);
});

it.each([
  { direction: [0, 0, 0] },
  { direction: [0, 0, 2] },
  { direction: [NaN, 0, 1] },
  { direction: [Infinity, 0, 0] },
])('rejects invalid direction $direction', async ({ direction }) => {
  const d = driver();
  expect(d.pump.accept(d.input(0, 1, direction as [number, number, number]), 1000)).toBe(false);
  await d.pump.service(1000);
  expect(d.attack).not.toHaveBeenCalled();
});

it('rejects stale/future capture timestamps without burning the valid sequence', () => {
  const d = driver();
  expect(d.pump.accept(d.input(0, 1, [0, 0, -1], -1001), 1000)).toBe(false);
  expect(d.pump.accept(d.input(0, 1, [0, 0, -1], 1101), 1000)).toBe(false);
  expect(d.pump.accept(d.input(0), 1000)).toBe(true);
});
