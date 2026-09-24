import { expect, type Page } from '@playwright/test';
import { FaceMaterial, Voxel, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { HarnessMediaSnapshot, RenderedMaterialMeshSummary } from '../../../src/app/app-contracts';
import type { VoxelGeometryDefinitionV1 } from '@seedlands/stdlib/mod-api';
import { aimAtVoxelWithRealMouse } from './aim';
import {
  clickCanvasCenter,
  closeInventory,
  lockPointer,
  snapshot,
  voxelAt,
  waitForSnapshot,
  walkTo,
  type ClassicWindow,
} from './harness';
import { classicScenario, type Point } from './scenario';

type DoorPair = readonly [number, number];

export type V1SliceState = Readonly<{
  door: DoorPair;
  mediaRevision: number;
  worldEpoch: string;
}>;
type VoxelEvidence = Readonly<{ position: Point; voxel?: number }>;

const chunkOf = ([x, y, z]: Point): Point => [Math.floor(x / 32), Math.floor(y / 32), Math.floor(z / 32)];
const fluidCellAt = (page: Page, target: Point) =>
  page.evaluate(
    (target) => (window as unknown as ClassicWindow).__seedlandsHarness?.getFluidCell?.(...target) ?? null,
    target,
  );
const voxelGeometry = (page: Page, voxel: number): Promise<VoxelGeometryDefinitionV1 | null> =>
  page.evaluate(
    (voxel) => (window as unknown as ClassicWindow).__seedlandsHarness?.getVoxelGeometry(voxel) ?? null,
    voxel,
  );
const renderedMaterialMesh = (
  page: Page,
  chunk: Point,
  material: FaceMaterialId,
): Promise<RenderedMaterialMeshSummary | null> =>
  page.evaluate(
    ({ chunk, material }) =>
      (window as unknown as ClassicWindow).__seedlandsHarness?.getRenderedMaterialMesh(...chunk, material) ?? null,
    { chunk, material },
  );
const mediaSnapshot = (page: Page): Promise<HarnessMediaSnapshot | null> =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness?.mediaSnapshot() ?? null);
const runtimeEpoch = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.identity();
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    if (typeof result.data.epoch !== 'string') throw new Error('Classic runtime epoch is unavailable.');
    return result.data.epoch;
  });

const doorPair = async (page: Page): Promise<DoorPair> => [
  (await voxelAt(page, classicScenario.v1Slice.door.lower)) ?? -1,
  (await voxelAt(page, classicScenario.v1Slice.door.upper)) ?? -1,
];

export function expectV1DoorEvidence(entries: readonly VoxelEvidence[], expected: DoorPair): void {
  const { lower, upper } = classicScenario.v1Slice.door;
  const voxelAtPosition = (target: Point) =>
    entries.find(({ position }) => position.every((coordinate, axis) => coordinate === target[axis]))?.voxel;
  expect([voxelAtPosition(lower), voxelAtPosition(upper)]).toEqual(expected);
}

async function selectCreativeItem(page: Page, name: string, itemId: string): Promise<void> {
  await page.keyboard.press('KeyE');
  const survival = page.getByRole('dialog', { name: '背包与合成' });
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  if (await survival.isVisible()) await survival.getByRole('button', { name: '切换创造模式', exact: true }).click();
  await expect(catalog).toBeVisible();
  await catalog.locator('#creative-item-filter').fill(name);
  await catalog.getByRole('button', { name: new RegExp(`^将${name}放入创造快捷栏 `) }).click();
  await closeInventory(page);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', itemId);
}

async function clearCreativeItem(page: Page): Promise<void> {
  await page.keyboard.press('KeyE');
  const survival = page.getByRole('dialog', { name: '背包与合成' });
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  if (await survival.isVisible()) await survival.getByRole('button', { name: '切换创造模式', exact: true }).click();
  await expect(catalog).toBeVisible();
  await catalog.getByRole('button', { name: /^清空创造快捷栏 / }).click();
  await closeInventory(page);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', 'empty');
}

async function switchToSurvival(page: Page): Promise<void> {
  await page.keyboard.press('KeyE');
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  await catalog.getByRole('button', { name: '切换生存模式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
  await closeInventory(page);
}

async function placeSelected(page: Page, support: Point, target: Point): Promise<void> {
  await aimAtVoxelWithRealMouse(page, support, target);
  await clickCanvasCenter(page, 'right');
}

const thinAxis = (minimum: readonly number[], maximum: readonly number[]) =>
  maximum.map((value, axis) => value - minimum[axis]!).findIndex((extent) => extent <= 3 / 16 + 0.001);

async function expectDoorMesh(page: Page, voxel: number, expectedThinAxis: 0 | 2, expectedEpoch: string) {
  const descriptor = await voxelGeometry(page, voxel);
  expect(descriptor).not.toBeNull();
  expect(descriptor?.occludesFullFace).toBe(false);
  expect(descriptor?.boxes).toHaveLength(1);
  expect(thinAxis(descriptor!.boxes[0]!.min, descriptor!.boxes[0]!.max)).toBe(expectedThinAxis);

  const chunks = [classicScenario.v1Slice.door.lower, classicScenario.v1Slice.door.upper].map(chunkOf);
  let meshes = await Promise.all(chunks.map((chunk) => renderedMaterialMesh(page, chunk, FaceMaterial.WoodenDoor)));
  await expect
    .poll(async () => {
      meshes = await Promise.all(chunks.map((chunk) => renderedMaterialMesh(page, chunk, FaceMaterial.WoodenDoor)));
      return meshes.map((mesh) => (mesh ? thinAxis(mesh.min, mesh.max) : -1));
    })
    .toEqual([expectedThinAxis, expectedThinAxis]);
  const currentEpoch = (await mediaSnapshot(page))?.worldEpoch;
  expect(currentEpoch).toBe(expectedEpoch);
  for (const mesh of meshes) {
    expect(mesh?.vertexCount).toBeGreaterThan(0);
    expect(mesh?.indexCount).toBeGreaterThan(0);
    expect(mesh?.worldEpoch).toBe(expectedEpoch);
  }
  return meshes[0]!;
}

async function expectClosedDoorBlocks(page: Page): Promise<void> {
  const target = classicScenario.v1Slice.door.lower;
  await aimAtVoxelWithRealMouse(page, target);
  const before = (await snapshot(page))!;
  await page.keyboard.down('KeyW');
  try {
    await page.waitForTimeout(1_500);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const blocked = await waitForSnapshot(
    page,
    (value) => value.authority.acknowledgedInputSequence > before.authority.acknowledgedInputSequence,
  );
  expect(blocked.player[0]).toBeLessThan(target[0] + 0.75);
}

export async function expectV1AudioSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置' });
  for (const label of ['总音量', '音乐音量', '音效音量', '环境音量'])
    await expect(settings.getByLabel(label)).toHaveCount(1);
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
  await settings.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  await lockPointer(page);
}

export async function completeV1SliceBeforeSave(page: Page): Promise<V1SliceState> {
  const { water, door, jukebox } = classicScenario.v1Slice;
  const worldEpoch = await runtimeEpoch(page);

  await walkTo(page, water.approach, { key: 'KeyS', jump: true });
  await selectCreativeItem(page, '水桶', 'water-bucket');
  await placeSelected(page, water.support, water.target);
  await expect.poll(() => voxelAt(page, water.target)).toBe(Voxel.Water);
  await expect.poll(() => fluidCellAt(page, water.target)).toMatchObject({ source: true });
  await selectCreativeItem(page, '桶', 'bucket');
  await aimAtVoxelWithRealMouse(page, water.target);
  await clickCanvasCenter(page, 'right');
  await expect.poll(() => voxelAt(page, water.target)).toBe(Voxel.Air);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', 'bucket');

  await walkTo(page, door.approach, { jump: true });
  await selectCreativeItem(page, '木门', 'wooden-door');
  await placeSelected(page, door.support, door.lower);
  await expect.poll(async () => (await doorPair(page)).every((voxel) => voxel >= 89 && voxel <= 104)).toBe(true);
  const placed = await doorPair(page);
  const closedMesh = await expectDoorMesh(page, placed[0], 0, worldEpoch);
  expect((await voxelGeometry(page, placed[0]))?.collision).toHaveLength(1);
  await switchToSurvival(page);
  await expectClosedDoorBlocks(page);

  await aimAtVoxelWithRealMouse(page, door.lower);
  await clickCanvasCenter(page, 'right');
  await expect.poll(() => doorPair(page)).not.toEqual(placed);
  const opened = await doorPair(page);
  expect((await voxelGeometry(page, opened[0]))?.collision).toHaveLength(0);
  const openedMesh = await expectDoorMesh(page, opened[0], 2, worldEpoch);
  expect(openedMesh.chunkRevision).toBeGreaterThan(closedMesh.chunkRevision);
  await walkTo(page, [door.lower[0] + 1.5, door.lower[2] + 0.5], { jump: true });

  await aimAtVoxelWithRealMouse(page, door.upper);
  await clickCanvasCenter(page, 'right');
  await expect.poll(() => doorPair(page)).toEqual(placed);
  await aimAtVoxelWithRealMouse(page, door.lower);
  await clickCanvasCenter(page, 'right');
  await expect.poll(() => doorPair(page)).toEqual(opened);

  await walkTo(page, jukebox.approach, { jump: true });
  await selectCreativeItem(page, '唱片机', 'jukebox');
  await placeSelected(page, jukebox.support, jukebox.target);
  await expect.poll(() => voxelAt(page, jukebox.target)).toBe(Voxel.Jukebox);
  await selectCreativeItem(page, '唱片 13', 'record-13');
  await aimAtVoxelWithRealMouse(page, jukebox.target);
  await clickCanvasCenter(page, 'right');

  let media = await mediaSnapshot(page);
  await expect
    .poll(async () => {
      media = await mediaSnapshot(page);
      return media?.projection.find(({ device }) => device.position.join(',') === jukebox.target.join(','));
    })
    .toMatchObject({ slot: { itemId: 'seedlands:record-13' }, playing: true, resumePending: false });
  const projection = media!.projection.find(({ device }) => device.position.join(',') === jukebox.target.join(','))!;
  await expect
    .poll(async () => (await mediaSnapshot(page))?.lastForwardedBatch?.facts)
    .toMatchObject([
      { kind: 'insert-and-activate', device: { position: jukebox.target }, revision: projection.revision },
    ]);
  media = await mediaSnapshot(page);
  expect(media?.lastForwardedBatch?.facts).toHaveLength(1);
  expect(media?.worldEpoch).not.toBeNull();
  await expect
    .poll(
      async () =>
        (await mediaSnapshot(page))?.audio?.instances.find(({ key }) => key.includes(jukebox.target.join(',')))?.phase,
    )
    .toBe('playing');
  await switchToSurvival(page);

  return { door: opened, mediaRevision: projection.revision, worldEpoch };
}

export async function verifyV1SliceAfterRestore(
  page: Page,
  before: V1SliceState,
  restoredEpoch: string,
): Promise<void> {
  const { jukebox } = classicScenario.v1Slice;
  await expect.poll(() => doorPair(page)).toEqual(before.door);
  let media = await mediaSnapshot(page);
  await expect
    .poll(async () => {
      media = await mediaSnapshot(page);
      return media?.projection.find(({ device }) => device.position.join(',') === jukebox.target.join(','));
    })
    .toMatchObject({
      revision: before.mediaRevision,
      slot: { itemId: 'seedlands:record-13' },
      playing: false,
      resumePending: true,
    });
  expect(media?.worldEpoch).toBe(restoredEpoch);
  expect(media?.worldEpoch).not.toBe(before.worldEpoch);
  expect(media?.lastForwardedBatch).toBeNull();
  expect(media?.audio?.instances).toMatchObject([{ phase: 'resume-pending', revision: before.mediaRevision }]);

  await lockPointer(page);
  await expect
    .poll(
      async () =>
        (await mediaSnapshot(page))?.audio?.instances.find(({ key }) => key.includes(jukebox.target.join(',')))?.phase,
    )
    .toBe('playing');
  expect((await mediaSnapshot(page))?.lastForwardedBatch).toBeNull();

  await walkTo(page, jukebox.approach, { jump: true });
  await clearCreativeItem(page);
  await aimAtVoxelWithRealMouse(page, jukebox.target);
  await clickCanvasCenter(page, 'right');
  await expect
    .poll(
      async () =>
        (await mediaSnapshot(page))?.projection.find(
          ({ device }) => device.position.join(',') === jukebox.target.join(','),
        )?.slot,
    )
    .toBeNull();
  await expect
    .poll(async () => (await mediaSnapshot(page))?.lastForwardedBatch?.facts)
    .toMatchObject([{ kind: 'eject', device: { position: jukebox.target }, playing: false }]);
  await expect
    .poll(
      async () =>
        (await mediaSnapshot(page))?.audio?.instances.find(({ key }) => key.includes(jukebox.target.join(',')))?.phase,
    )
    .toBe('idle');
  await switchToSurvival(page);
}

export async function expectWorldAudioReleased(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsAudio?.snapshot().worldMedia ?? null),
    )
    .toBeNull();
}
