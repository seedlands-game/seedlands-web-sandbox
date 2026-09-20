import { expect, type Page } from '@playwright/test';
import type { CharacterObservation, ChromeTrace, PlayerState } from './harness';
import type { AuthorityVoxelEvidence, CheckpointVoxelEvidence } from './restore';
import type { Point } from './scenario';

export const inventorySignature = (state: PlayerState) =>
  state.inventory.map((item) =>
    item ? { itemId: item.itemId, count: item.count, durability: item.instance?.durability } : null,
  );

export const itemCount = (state: PlayerState, itemId: string) =>
  state.inventory.reduce((total, item) => total + (item?.itemId === itemId ? item.count : 0), 0);

export const mergeRestoreEvidence = (
  evidence: Readonly<Record<string, unknown>> | undefined,
  phase: 'before' | 'after',
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  ...(evidence ?? {}),
  [phase]: { ...((evidence?.[phase] as Readonly<Record<string, unknown>> | undefined) ?? {}), ...value },
});

export async function equipFromInventory(page: Page, name: string): Promise<void> {
  const panel = page.getByRole('dialog', { name: '背包与合成' });
  let slot = panel.getByRole('gridcell', { name: new RegExp(`^${name} × \\d+(?: ·.*)?$`) }).first();
  await expect(slot).toBeVisible();
  const sourceSlot = Number(await slot.getAttribute('data-slot'));
  if (!Number.isSafeInteger(sourceSlot)) throw new Error(`Inventory slot for ${name} has no stable address.`);
  if (sourceSlot !== 0) {
    const hotbarSlot = panel.locator('[role="gridcell"][data-slot="0"]');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (new RegExp(`^${name} × \\d+`).test((await hotbarSlot.getAttribute('aria-label')) ?? '')) return;
      slot = panel.getByRole('gridcell', { name: new RegExp(`^${name} × \\d+(?: ·.*)?$`) }).first();
      await slot.hover();
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(100);
    }
    await expect(hotbarSlot).toHaveAttribute('aria-label', new RegExp(`^${name} × \\d+`));
  }
}

export const completedNpcActivity = (observations: readonly CharacterObservation[], sinceCursor: number) => {
  const events = observations.flatMap(({ events }) => events).filter((event) => event.cursor > sinceCursor);
  const identity = (event: (typeof events)[number]) =>
    typeof event.nodeId === 'string' && typeof event.episode === 'number' && Number.isSafeInteger(event.episode)
      ? `${event.nodeId}:${event.episode}`
      : null;
  const starts = new Set(
    events.flatMap((event) => {
      const key = identity(event);
      return event.type === 'activity-started' && key ? [key] : [];
    }),
  );
  return events.find((event) => {
    const key = identity(event);
    return event.type === 'activity-succeeded' && key && starts.has(key);
  });
};

export const observedVoxel = (
  entries: readonly (AuthorityVoxelEvidence | CheckpointVoxelEvidence)[],
  position: Point,
) => {
  const entry = entries.find((candidate) => candidate.position.every((value, index) => value === position[index]));
  return entry && 'voxel' in entry ? entry.voxel : null;
};

export const traceEpoch = (trace: ChromeTrace, epoch: unknown, stageRange: 'C0-C4' | 'C5'): ChromeTrace => ({
  traceEvents: trace.traceEvents.map((event) => ({
    ...event,
    args: { ...event.args, runtimeEpoch: String(epoch), stageRange },
  })),
});
