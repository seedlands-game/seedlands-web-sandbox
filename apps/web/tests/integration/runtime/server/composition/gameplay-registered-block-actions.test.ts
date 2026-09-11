import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { GameServer } from '../../../../fixtures/classic/content';
import { Voxel } from '../../../../../../../packages/stdlib/src/world/voxel';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

function setup(withBlocks = true, extra: ModModule[] = [], cloneHook?: (value: unknown) => void) {
  const modules = [
    ...pack.modules.filter((module) => withBlocks || !module.descriptor.id.includes('block-')),
    ...extra,
  ];
  const root = definePack({ id: 'test:block-actions', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...root,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    {
      approvedPermissions: { 'test:block-actions': modules.flatMap((module) => module.descriptor.permissions ?? []) },
    },
  );
  const authority = createGameplayActorAuthority(composition.resources, { playerAlias: 'human' });
  let revoked = false;
  const server = new GameServer({
    seedText: 'registered-block-owner',
    platform: {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        cloneHook?.(value);
        return structuredClone(value);
      },
    },
    composition,
    moduleActorAuthority: {
      forActor: authority.forActor,
      resolveOrigin: (origin, kind) => (revoked ? undefined : authority.resolveOrigin(origin, kind)),
    },
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  });
  server.editBatch({ actorId: 'setup', edits: [{ x: 2, y: 60, z: 0, value: Voxel.Air }] });
  server.spawnPlayer({ id: 'alice', position: [0.5, 60, 0.5] });
  server.giveItem('alice', { itemId: 'wood-block', count: 2 });
  return {
    server,
    authority,
    revoke: () => {
      revoked = true;
    },
  };
}
const position: [number, number, number] = [2, 60, 0];
const snapshot = (server: GameServer) => server.freezePortableSaveSnapshot();

describe('actual registered Block consumers', () => {
  it('rejects placement and mining when the Block provider is omitted', () => {
    const { server } = setup(false);
    const before = snapshot(server);
    expect(server.placeVoxel('alice', position).success).toBe(false);
    expect(server.beginBreak('alice', position).success).toBe(false);
    expect(snapshot(server)).toEqual(before);
  });
  it('captures the actual actor origin and completes a surviving break once through the world clock', () => {
    const { server } = setup();
    const placed = server.placeVoxel('alice', position);
    expect(placed.success, JSON.stringify(placed)).toBe(true);
    const started = server.beginBreak('alice', position);
    expect(started.success, JSON.stringify(started)).toBe(true);
    expect(server.getPlayerState('alice').breakAction).toMatchObject({
      origin: { principalSubject: 'seedlands:local-player', originalActor: { entityId: 'alice' } },
    });
    expect(server.advanceGameplayRules(1.2).commits).toHaveLength(1);
    expect(server.getVoxel(...position)).toBe(Voxel.Air);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(1);
    expect(server.advanceGameplayRules(1.2).commits).toHaveLength(0);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(1);
  });
  it('cancels accepted mining when its current origin is revoked without creating a drop', () => {
    const { server, revoke } = setup();
    const placed = server.placeVoxel('alice', position);
    expect(placed.success, JSON.stringify(placed)).toBe(true);
    const started = server.beginBreak('alice', position);
    expect(started.success, JSON.stringify(started)).toBe(true);
    revoke();
    expect(server.advanceGameplayRules(1.2).commits).toHaveLength(0);
    expect(server.getVoxel(...position)).toBe(Voxel.Wood);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(0);
    expect(server.getPlayerState('alice').breakAction).toBeNull();
  });
  it.each(['place', 'begin'] as const)('leaves all owners unchanged when an after rule rejects %s', (kind) => {
    const { server } = setup(true, [
      {
        descriptor: {
          id: 'test:block-veto',
          version: '1.0.0',
          permissions: [{ resource: 'seedlands.block-voxel', operations: ['execute'] }],
        },
        register(api) {
          api.registerRule({
            id: 'test:block-veto',
            operationId: `seedlands:block-${kind}`,
            stage: 'after',
            apply: () => ({ reject: 'protected-land' }),
          });
        },
      },
    ]);
    if (kind === 'begin') server.editBatch({ actorId: 'setup', edits: [{ x: 2, y: 60, z: 0, value: Voxel.Wood }] });
    const before = snapshot(server);
    expect(
      kind === 'place' ? server.placeVoxel('alice', position) : server.beginBreak('alice', position),
    ).toMatchObject({ success: false, reason: 'protected-land' });
    expect(snapshot(server)).toEqual(before);
  });
  it('does not change any owner when final placement receipt cloning fails', () => {
    let failed = false;
    const { server } = setup(true, [], (value) => {
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'place' && 'success' in value) {
        failed = true;
        throw new Error('test-final-clone-failure');
      }
    });
    const before = snapshot(server);
    expect(server.placeVoxel('alice', position)).toMatchObject({ success: false, reason: 'test-final-clone-failure' });
    expect(failed).toBe(true);
    expect(snapshot(server)).toEqual(before);
    expect(server.advanceGameplayRules(0).commits).toHaveLength(0);
  });
  it('revalidates current geometry after final placement receipt cloning', () => {
    const { server } = setup(true, [], (value) => {
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'place' && 'success' in value)
        move?.();
    });
    const inventory = server.getInventory('alice');
    const move = () => {
      server.updateEntity('alice', { position: [30, 60, 0] });
    };
    expect(server.placeVoxel('alice', position).success).toBe(false);
    expect(server.getVoxel(...position)).toBe(Voxel.Air);
    expect(server.getInventory('alice')).toEqual(inventory);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(0);
    expect(server.advanceGameplayRules(0).commits).toHaveLength(0);
  });
  it('does not let an actor complete a break before its host time has elapsed', () => {
    const { server, authority } = setup();
    server.placeVoxel('alice', position);
    server.beginBreak('alice', position);
    const before = snapshot(server);
    const binding = authority.forActor('alice', 'player')!;
    const result = server.invokeModuleOperation(
      binding.authorizer,
      { principalId: binding.principalId, originalActorId: 'alice' },
      {
        operationId: 'seedlands:block-finish',
        target: { kind: 'voxel', position },
        input: { position },
      },
    );
    expect(result.ok).toBe(false);
    expect(snapshot(server)).toEqual(before);
  });
  it('cancels a completed candidate rejected by the finish rule without producing effects', () => {
    const { server } = setup(true, [
      {
        descriptor: {
          id: 'test:finish-veto',
          version: '1.0.0',
          permissions: [{ resource: 'seedlands.block-voxel', operations: ['execute'] }],
        },
        register(api) {
          api.registerRule({
            id: 'test:finish-veto',
            operationId: 'seedlands:block-finish',
            stage: 'after',
            apply: () => ({ reject: 'protected-land' }),
          });
        },
      },
    ]);
    server.placeVoxel('alice', position);
    server.beginBreak('alice', position);
    expect(server.advanceGameplayRules(1.2).commits).toHaveLength(0);
    expect(server.getVoxel(...position)).toBe(Voxel.Wood);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(0);
    expect(server.getPlayerState('alice').breakAction).toBeNull();
  });
  it('honors a Block clock rule that pauses progress before producing a completion effect', () => {
    let paused = false;
    const { server } = setup(true, [
      {
        descriptor: {
          id: 'test:pause-mining',
          version: '1.0.0',
          permissions: [{ resource: 'seedlands.block-clock', operations: ['execute'] }],
        },
        register(api) {
          api.registerRule({
            id: 'test:pause-mining',
            operationId: 'seedlands:block-advance',
            stage: 'before',
            apply: () => (paused ? { input: { seconds: 0 } } : undefined),
          });
        },
      },
    ]);
    server.placeVoxel('alice', position);
    server.beginBreak('alice', position);
    server.advanceGameplayRules(0.4);
    paused = true;
    expect(server.advanceGameplayRules(1).commits).toHaveLength(0);
    expect(server.getVoxel(...position)).toBe(Voxel.Wood);
    expect(server.getPlayerState('alice').breakAction?.elapsedSeconds).toBe(0.4);
  });
  it('retains earlier actor receipts when a later completion fails and retries only that actor', () => {
    let rejectBob = true;
    const { server } = setup(true, [], (value) => {
      if (
        rejectBob &&
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'finish' &&
        'success' in value &&
        'actorId' in value &&
        value.actorId === 'bob'
      )
        throw new Error('bob-finish-failed');
    });
    server.spawnPlayer({ id: 'bob', position: [0.5, 60, 1.5] });
    const second: [number, number, number] = [2, 60, 1];
    server.editBatch({ actorId: 'setup', edits: [{ x: 2, y: 60, z: 1, value: Voxel.Air }] });
    server.giveItem('bob', { itemId: 'wood-block', count: 1 });
    server.placeVoxel('alice', position);
    server.placeVoxel('bob', second);
    server.beginBreak('alice', position);
    server.beginBreak('bob', second);
    expect(() => server.advanceGameplayRules(1.2)).toThrow('bob-finish-failed');
    expect(server.getVoxel(...position)).toBe(Voxel.Air);
    expect(server.getVoxel(...second)).toBe(Voxel.Wood);
    expect(server.getPlayerState('alice').breakAction).toBeNull();
    expect(server.getPlayerState('bob').breakAction?.elapsedSeconds).toBe(1.2);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(1);
    expect(() => snapshot(server)).not.toThrow();
    rejectBob = false;
    expect(server.advanceGameplayRules(0).commits).toHaveLength(2);
    expect(server.advanceGameplayRules(0).commits).toHaveLength(0);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(2);
  });
  it('does not complete mining when an after rule vetoes its next clock commit', () => {
    let veto = false;
    const { server } = setup(true, [
      {
        descriptor: {
          id: 'test:veto-clock',
          version: '1.0.0',
          permissions: [{ resource: 'seedlands.block-clock', operations: ['execute'] }],
        },
        register(api) {
          api.registerRule({
            id: 'test:veto-clock',
            operationId: 'seedlands:block-advance',
            stage: 'after',
            apply: () => (veto ? { reject: 'clock-blocked' } : undefined),
          });
        },
      },
    ]);
    server.placeVoxel('alice', position);
    server.beginBreak('alice', position);
    server.advanceGameplayRules(0.4);
    veto = true;
    expect(() => server.advanceGameplayRules(1)).toThrow('clock-blocked');
    expect(server.getVoxel(...position)).toBe(Voxel.Wood);
    expect(server.getPlayerState('alice').breakAction?.elapsedSeconds).toBe(0.4);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(0);
  });
});
