import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

function setup(
  extra: readonly ModModule[] = [],
  observeClone?: () => void,
  getVoxel = ([, y]: [number, number, number]) => (y === 0 ? 3 : 0),
) {
  const modules = [...pack.modules, ...extra];
  const selected = definePack({ id: 'test:prepared-mode', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...selected,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:prepared-mode': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const authority = createGameplayActorAuthority(composition.resources, { playerAlias: 'prepared-player' });
  const platform: CorePlatformPorts = Object.freeze({
    ...testCorePlatform,
    clone: <Value>(value: Value): Value => {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 2 &&
        'mode' in value &&
        'modeRevision' in value
      )
        observeClone?.();
      return structuredClone(value);
    },
  });
  const gameplay = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: authority,
    platform,
    getWorldTime: () => 0,
    getVoxel,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  gameplay.spawnPlayer({ id: 'alice', position: [0.5, 3, 0.5] });
  gameplay.entities.update('alice', { physicsVelocity: [1, 2, 3] });
  gameplay.entities.playerStateAccess('alice').breakAction = {
    position: [1, 1, 1],
    voxel: 3,
    elapsedSeconds: 0.25,
    requiredSeconds: 1,
  };
  const binding = authority.forActor('alice', 'player')!;
  const operations = gameplay.bindModuleOperations(binding.authorizer, {
    moduleId: 'seedlands:mode-module',
    principalId: binding.principalId,
    originalActorId: 'alice',
  });
  const setMode = (mode: 'creative' | 'survival') =>
    operations.invoke({
      operationId: 'seedlands:set-mode',
      target: { kind: 'entity', entityId: 'alice' },
      input: { mode },
    });
  return { gameplay, setMode };
}

describe('prepared registered Mode owner', () => {
  it('copies the final result while ECS is unchanged, then installs the complete prepared transition', () => {
    const current: { world?: ReturnType<typeof setup> } = {};
    let observedBeforeApply = 0;
    const world = setup([], () => {
      expect(current.world!.gameplay.getActorModeState('alice')).toMatchObject({ mode: 'survival', modeRevision: 0 });
      expect(current.world!.gameplay.entities.playerStateAccess('alice').breakAction).not.toBeNull();
      observedBeforeApply += 1;
    });
    current.world = world;
    const beforeRevision = world.gameplay.gameplayRevision;

    expect(world.setMode('creative')).toEqual({
      ok: true,
      value: { mode: 'creative', modeRevision: 1 },
      revision: beforeRevision + 1,
    });
    // The operation result and then the prepared owner's final result are both copied before apply.
    expect(observedBeforeApply).toBe(2);
    expect(world.gameplay.getActorModeState('alice')).toMatchObject({
      mode: 'creative',
      modeRevision: 1,
      flight: { enabled: true },
    });
    expect(world.gameplay.entities.get('alice')).toMatchObject({ physicsVelocity: [0, 0, 0] });
    expect(world.gameplay.entities.playerStateAccess('alice').breakAction).toBeNull();
  });

  it('rejects a survival landing whose supporting world changed during final result clone', () => {
    let support = true,
      cloneCount = 0,
      armed = false;
    const world = setup(
      [],
      () => {
        if (armed && ++cloneCount === 2) support = false;
      },
      ([, y]) => (support && y === 0 ? 3 : 0),
    );
    expect(world.setMode('creative').ok).toBe(true);
    const before = world.gameplay.createSnapshot();
    armed = true;
    expect(world.setMode('survival')).toMatchObject({ ok: false });
    expect(cloneCount).toBe(2);
    expect(world.gameplay.createSnapshot()).toEqual(before);
  });

  it('rejects an after rule before preparing cancellation, ECS, or gameplay revision writes', () => {
    const reject: ModModule = {
      descriptor: {
        id: 'test:reject-mode',
        version: '1.0.0',
        permissions: [{ resource: 'seedlands.mode', operations: ['execute'] }],
      },
      register(api) {
        api.registerRule({
          id: 'test:reject-mode-after',
          operationId: 'seedlands:set-mode',
          stage: 'after',
          apply() {
            return { reject: 'mode-disabled' };
          },
        });
      },
    };
    const world = setup([reject]);
    const before = world.gameplay.createSnapshot();

    expect(world.setMode('creative')).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
    expect(world.gameplay.createSnapshot()).toEqual(before);
    expect(world.gameplay.entities.playerStateAccess('alice').breakAction).not.toBeNull();
  });
});
