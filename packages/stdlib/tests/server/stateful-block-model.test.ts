import { describe, expect, it } from 'vitest';
import {
  buildStatefulBlockActionCandidateV1,
  createStatefulBlockDefinitionRegistryV1,
  createStatefulBlockStateV1,
  defineStatefulBlockV1,
  restoreStatefulBlockCheckpointV1,
  snapshotStatefulBlockCheckpointV1,
  type StatefulBlockDefinitionRegistryV1,
  type StatefulBlockStateV1,
} from '../../src/server/gameplay/modules/stateful-block-model';

const definitions = (): StatefulBlockDefinitionRegistryV1 =>
  createStatefulBlockDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:message-panel',
      kind: 'text',
      voxelVariants: [201],
      textPolicy: { voxelVariant: 201, maxCodePoints: 32, maxLines: 4, maxLineCodePoints: 8 },
    },
    {
      version: 1,
      id: 'sample:portion-block',
      kind: 'counter',
      voxelVariants: [210, 211, 212],
      counterPolicy: { variantsByRemaining: [210, 211, 212] },
    },
    {
      version: 1,
      id: 'sample:tone-block',
      kind: 'note',
      voxelVariants: [220],
      notePolicy: { voxelVariant: 220, minimum: 0, maximum: 2, initial: 0 },
    },
    {
      version: 1,
      id: 'sample:toggle-panel',
      kind: 'toggle',
      voxelVariants: [230, 231],
      togglePolicy: { offVoxel: 230, onVoxel: 231, initial: false },
    },
  ]);

const successful = (result: ReturnType<typeof buildStatefulBlockActionCandidateV1>) => {
  if (!result.success) throw new Error(`Expected success, received ${result.reason}`);
  return result;
};

describe('StatefulBlockDefinitionV1 typed model', () => {
  it('validates and freezes four bounded policy variants without an open JSON schema', () => {
    const registry = definitions();
    expect(registry.list().map(({ id, kind }) => [id, kind])).toEqual([
      ['sample:message-panel', 'text'],
      ['sample:portion-block', 'counter'],
      ['sample:toggle-panel', 'toggle'],
      ['sample:tone-block', 'note'],
    ]);
    expect(registry.resolveVariant(212)?.id).toBe('sample:portion-block');
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(registry.require('sample:message-panel').voxelVariants)).toBe(true);
    expect(() =>
      defineStatefulBlockV1({
        version: 1,
        id: 'sample:bad',
        kind: 'text',
        voxelVariants: [201],
        textPolicy: { voxelVariant: 201, maxCodePoints: 32, maxLines: 4, maxLineCodePoints: 8 },
        arbitrary: {},
      }),
    ).toThrow(/fields/i);
    expect(() =>
      createStatefulBlockDefinitionRegistryV1([
        registry.require('sample:message-panel'),
        {
          version: 1,
          id: 'sample:conflict',
          kind: 'note',
          voxelVariants: [201],
          notePolicy: { voxelVariant: 201, minimum: 0, maximum: 1, initial: 0 },
        },
      ]),
    ).toThrow(/conflicts/i);
  });

  it('updates bounded text and rejects stale, unchanged, multiline overflow and control characters without mutation', () => {
    const definition = definitions().require('sample:message-panel');
    const source = createStatefulBlockStateV1(definition, [2, 3, 4]);
    const before = structuredClone(source);
    const updated = successful(
      buildStatefulBlockActionCandidateV1(definition, source, {
        kind: 'set-text',
        expectedRevision: 0,
        text: 'hello\nworld',
      }),
    );
    expect(updated).toMatchObject({
      next: { revision: 1, kind: 'text', text: 'hello\nworld' },
      fact: { kind: 'text-updated', revision: 1, text: 'hello\nworld' },
    });
    expect(
      buildStatefulBlockActionCandidateV1(definition, source, { kind: 'set-text', expectedRevision: 1, text: 'x' }),
    ).toEqual({
      success: false,
      reason: 'stale-revision',
    });
    expect(
      buildStatefulBlockActionCandidateV1(definition, source, { kind: 'set-text', expectedRevision: 0, text: '' }),
    ).toEqual({
      success: false,
      reason: 'no-change',
    });
    for (const text of ['123456789', 'a\nb\nc\nd\ne', 'bad\u0000text'])
      expect(
        buildStatefulBlockActionCandidateV1(definition, source, { kind: 'set-text', expectedRevision: 0, text }),
      ).toEqual({ success: false, reason: 'invalid-text' });
    expect(source).toEqual(before);
  });

  it('decrements a counter through declared variants and removes it exactly at zero', () => {
    const definition = definitions().require('sample:portion-block');
    const source = createStatefulBlockStateV1(definition, [0, 0, 0]);
    expect(source).toMatchObject({ kind: 'counter', remaining: 3, voxelVariant: 212, revision: 0 });
    const two = successful(
      buildStatefulBlockActionCandidateV1(definition, source, { kind: 'decrement', expectedRevision: 0 }),
    );
    expect(two.next).toMatchObject({ remaining: 2, voxelVariant: 211, revision: 1 });
    const one = successful(
      buildStatefulBlockActionCandidateV1(definition, two.next!, { kind: 'decrement', expectedRevision: 1 }),
    );
    expect(one.next).toMatchObject({ remaining: 1, voxelVariant: 210, revision: 2 });
    const removed = successful(
      buildStatefulBlockActionCandidateV1(definition, one.next!, { kind: 'decrement', expectedRevision: 2 }),
    );
    expect(removed.next).toBeNull();
    expect(removed.fact).toMatchObject({ kind: 'counter-decremented', remaining: 0, removed: true, revision: 3 });
  });

  it('cycles notes with bounded wrap and emits a trigger fact without changing the note', () => {
    const definition = definitions().require('sample:tone-block');
    let current = createStatefulBlockStateV1(definition, [1, 0, 0]);
    for (const note of [1, 2, 0]) {
      const cycled = successful(
        buildStatefulBlockActionCandidateV1(definition, current, {
          kind: 'cycle-note',
          expectedRevision: current.revision,
        }),
      );
      expect(cycled.fact).toMatchObject({ kind: 'note-cycled', note });
      current = cycled.next!;
    }
    const triggered = successful(
      buildStatefulBlockActionCandidateV1(definition, current, {
        kind: 'trigger-note',
        expectedRevision: current.revision,
      }),
    );
    expect(triggered).toMatchObject({
      next: { kind: 'note', note: 0, revision: 4 },
      fact: { kind: 'note-triggered', note: 0, revision: 4 },
    });
  });

  it('toggles exactly between two declared variants and rejects the wrong action without mutation', () => {
    const definition = definitions().require('sample:toggle-panel');
    const source = createStatefulBlockStateV1(definition, [2, 0, 0]);
    const before = structuredClone(source);
    const active = successful(
      buildStatefulBlockActionCandidateV1(definition, source, { kind: 'toggle', expectedRevision: 0 }),
    );
    expect(active).toMatchObject({
      next: { active: true, voxelVariant: 231, revision: 1 },
      fact: { kind: 'toggled', active: true, revision: 1 },
    });
    const inactive = successful(
      buildStatefulBlockActionCandidateV1(definition, active.next!, { kind: 'toggle', expectedRevision: 1 }),
    );
    expect(inactive.next).toMatchObject({ active: false, voxelVariant: 230, revision: 2 });
    expect(buildStatefulBlockActionCandidateV1(definition, source, { kind: 'decrement', expectedRevision: 0 })).toEqual(
      { success: false, reason: 'wrong-action' },
    );
    expect(source).toEqual(before);
  });

  it('validates, sorts, snapshots and restores checkpoints while rejecting malformed entries atomically', () => {
    const registry = definitions();
    const entries = [
      createStatefulBlockStateV1(registry.require('sample:toggle-panel'), [5, 0, 0]),
      createStatefulBlockStateV1(registry.require('sample:message-panel'), [-1, 0, 0]),
    ];
    const checkpoint = snapshotStatefulBlockCheckpointV1(entries, registry);
    expect(checkpoint.entries.map(({ position }) => position)).toEqual([
      [-1, 0, 0],
      [5, 0, 0],
    ]);
    expect(restoreStatefulBlockCheckpointV1(structuredClone(checkpoint), registry)).toEqual(checkpoint);
    expect(restoreStatefulBlockCheckpointV1(undefined, registry)).toEqual({ version: 1, entries: [] });
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.entries)).toBe(true);

    const before = structuredClone(checkpoint);
    const malformed: Array<readonly StatefulBlockStateV1[]> = [
      [entries[0]!, { ...entries[1]!, position: entries[0]!.position }],
      [{ ...entries[0]!, definitionId: 'sample:missing' }],
      [{ ...entries[0]!, revision: Number.NaN }],
      [{ ...entries[0]!, voxelVariant: 999 }],
    ];
    for (const invalid of malformed)
      expect(() => restoreStatefulBlockCheckpointV1({ version: 1, entries: invalid }, registry)).toThrow();
    expect(checkpoint).toEqual(before);
  });
});
