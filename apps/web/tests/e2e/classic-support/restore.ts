import { expect, type Page } from '@playwright/test';
import type { ClassicWindow } from './harness';
import type { Point } from './scenario';

export type AuthorityVoxelEvidence = Readonly<
  | {
      ok: true;
      position: Point;
      voxel: number;
      chunkRevision: number;
      frontier: Readonly<Record<string, unknown>>;
    }
  | { ok: false; position: Point; error: Readonly<{ code: string; message: string }> }
>;

export type CheckpointVoxelEvidence = Readonly<{
  position: Point;
  chunkKey: string;
  chunkRevision: number;
  voxelIndex: number;
  voxel: number;
  worldRevision: number;
  commitSequence: number;
  byteLength: number;
}>;

export type CheckpointCharacterEvidence = Readonly<{
  entityId: string;
  entity: Readonly<{
    type?: string;
    health?: number;
    maxHealth?: number;
    position?: Point;
  }> | null;
  actor: Readonly<{
    lifecycle?: string;
    needs?: Readonly<Record<string, unknown>>;
    inventory?: readonly unknown[];
  }> | null;
  simulationActor: Readonly<Record<string, unknown>> | null;
  character: Readonly<{
    entityId?: string;
    lifecycle?: string;
    revision?: number;
    lastPosition?: Point;
    lastBehavior?: string;
    eventCursor?: number;
    events?: readonly Readonly<Record<string, unknown>>[];
  }> | null;
}>;

export const authorityVoxels = (page: Page, positions: readonly Point[]): Promise<AuthorityVoxelEvidence[]> =>
  page.evaluate(async (positions) => {
    const world = (window as unknown as ClassicWindow).__seedlandsHarness!.world;
    const evidence: AuthorityVoxelEvidence[] = [];
    for (const position of positions) {
      const result = await world.inspect({ kind: 'voxel', position });
      if (!result.ok) evidence.push({ ok: false, position, error: result.error });
      else {
        const data = result.data as { voxel?: unknown; chunkRevision?: unknown };
        if (typeof data.voxel !== 'number' || typeof data.chunkRevision !== 'number')
          throw new Error(`Authority voxel inspection is malformed: ${JSON.stringify(result)}`);
        evidence.push({
          ok: true,
          position,
          voxel: data.voxel,
          chunkRevision: data.chunkRevision,
          frontier: result.frontier,
        });
      }
    }
    return evidence;
  }, positions);

export async function waitForAuthorityVoxels(
  page: Page,
  positions: readonly Point[],
  timeout = 30_000,
): Promise<AuthorityVoxelEvidence[]> {
  await expect
    .poll(async () => (await authorityVoxels(page, positions)).every((entry) => entry.ok), { timeout })
    .toBe(true);
  return authorityVoxels(page, positions);
}

export const checkpointVoxels = (page: Page, positions: readonly Point[]): Promise<CheckpointVoxelEvidence[]> =>
  page.evaluate(async (positions) => {
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.checkpoint({ kind: 'export' });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const payload = result.data as {
      byteLength?: unknown;
      snapshot?: {
        worldRevision?: unknown;
        commitSequence?: unknown;
        chunks?: Array<{ key?: unknown; revision?: unknown; voxels?: unknown }>;
      };
    };
    const snapshot = payload.snapshot;
    if (
      !snapshot ||
      typeof snapshot.worldRevision !== 'number' ||
      typeof snapshot.commitSequence !== 'number' ||
      typeof payload.byteLength !== 'number' ||
      !Array.isArray(snapshot.chunks)
    )
      throw new Error('Checkpoint voxel observation is unavailable.');
    return positions.map((position) => {
      const [x, y, z] = position;
      const cx = Math.floor(x / 32);
      const cy = Math.floor(y / 32);
      const cz = Math.floor(z / 32);
      const chunkKey = `${cx},${cy},${cz}`;
      const chunk = snapshot.chunks!.find((entry) => entry.key === chunkKey);
      if (!chunk || typeof chunk.revision !== 'number' || !(chunk.voxels instanceof Uint16Array))
        throw new Error(`Checkpoint Chunk ${chunkKey} is unavailable.`);
      const local = (value: number, chunk: number) => value - chunk * 32;
      const voxelIndex = local(x, cx) + local(z, cz) * 32 + local(y, cy) * 32 ** 2;
      return {
        position,
        chunkKey,
        chunkRevision: chunk.revision,
        voxelIndex,
        voxel: chunk.voxels[voxelIndex]!,
        worldRevision: snapshot.worldRevision as number,
        commitSequence: snapshot.commitSequence as number,
        byteLength: payload.byteLength as number,
      };
    });
  }, positions);

export const checkpointCharacter = (page: Page, entityId: string): Promise<CheckpointCharacterEvidence> =>
  page.evaluate(async (entityId) => {
    const result = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.checkpoint({ kind: 'export' });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    const payload = result.data as {
      snapshot?: {
        gameplay?: {
          entityStore?: {
            entities?: Array<{
              id?: string;
              type?: string;
              health?: number;
              maxHealth?: number;
              position?: Point;
            }>;
            actors?: Array<{
              entityId?: string;
              lifecycle?: string;
              needs?: Readonly<Record<string, unknown>>;
              inventory?: readonly unknown[];
              character?: CheckpointCharacterEvidence['character'];
            }>;
          };
          simulation?: {
            actors?: Array<Readonly<Record<string, unknown>> & { entityId?: string }>;
            characterTombstones?: { characters?: CheckpointCharacterEvidence['character'][] };
          };
        };
      };
    };
    const gameplay = payload.snapshot?.gameplay;
    if (!gameplay?.entityStore || !gameplay.simulation)
      throw new Error('Checkpoint character observation is unavailable.');
    const entity = gameplay.entityStore.entities?.find((candidate) => candidate.id === entityId) ?? null;
    const actor = gameplay.entityStore.actors?.find((candidate) => candidate.entityId === entityId) ?? null;
    const simulationActor = gameplay.simulation.actors?.find((candidate) => candidate.entityId === entityId) ?? null;
    const tombstone =
      gameplay.simulation.characterTombstones?.characters?.find((candidate) => candidate?.entityId === entityId) ??
      null;
    const character = actor?.character ?? tombstone;
    return {
      entityId,
      entity: entity
        ? {
            type: entity.type,
            health: entity.health,
            maxHealth: entity.maxHealth,
            position: entity.position,
          }
        : null,
      actor: actor
        ? {
            lifecycle: actor.lifecycle,
            needs: actor.needs,
            inventory: actor.inventory,
          }
        : null,
      simulationActor,
      character: character
        ? {
            entityId: character.entityId,
            lifecycle: character.lifecycle,
            revision: character.revision,
            lastPosition: character.lastPosition,
            lastBehavior: character.lastBehavior,
            eventCursor: character.eventCursor,
            events: character.events,
          }
        : null,
    };
  }, entityId);
