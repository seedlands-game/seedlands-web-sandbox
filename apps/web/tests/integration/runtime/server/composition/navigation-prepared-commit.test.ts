import { expect, it } from 'vitest';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { definePack, type ModModule, type ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
import { GameplayRuntime } from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { OVERWORLD_PRODUCT_PERMISSIONS } from '../../../../../../../packages/stdlib/src/server/composition/gameplay-composition';
import type { ActorModuleExecutionContext } from '../../../../../../../packages/stdlib/src/server/composition/authorized-execution';
import type { RegisteredCommitContext } from '../../../../../../../packages/stdlib/src/server/composition/operation-contracts';
import {
  buildNavigationCandidate,
  navigationAddress,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/navigation-interaction-model';
import { classicGameplayDomainModules } from './classic-gameplay-domain-options';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { classicNavigationConfig } from '../../../../../../../playbooks/classic/src/navigation-policy';

const OPERATION = 'seedlands:explore-held-map';
const RESOURCE = 'seedlands.navigation-item';
const COMPONENT = 'seedlands:navigation-map';
const selfInput = { version: 1, trigger: 'self', target: { kind: 'self' } } as const;
type RuleMode = 'veto' | 'forge' | 'capture' | 'capture-reject';
type Capture = { context?: ActorModuleExecutionContext };
const voxels = new Map<string, number>();

const makeRuleModule = (mode: RuleMode, capture: Capture): ModModule => ({
  descriptor: {
    id: 'test:navigation-commit-rules',
    version: '1.0.0',
    permissions: [{ resource: RESOURCE, operations: ['read', 'write', 'execute'] }],
  },
  register(api) {
    api.registerRule({
      id: `test:navigation-${mode}`,
      operationId: OPERATION,
      stage: 'after',
      apply(context, _input, state, candidate) {
        if (context.kind !== 'actor') throw new TypeError('Expected a registered navigation actor context.');
        capture.context = context;
        if (mode === 'veto' || mode === 'capture-reject') return { reject: 'navigation-test-veto' };
        if (mode === 'forge') {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !('sequence' in candidate))
            throw new TypeError('Expected the registered navigation candidate.');
          state.write({ componentId: COMPONENT, target: { kind: 'entity', entityId: context.originalActorId } }, {
            ...candidate,
            sequence: Number(candidate.sequence) + 1,
          } as ModuleInvocationValue);
        }
      },
    });
  },
});

const createWorld = (mode: RuleMode) => {
  const capture: Capture = {};
  const modules = [...classicGameplayDomainModules(['seedlands:overworld-navigation']), makeRuleModule(mode, capture)];
  const localPack = definePack({
    id: pack.manifest.id,
    version: pack.manifest.version,
    kind: pack.manifest.kind,
    entry: pack.manifest.entry,
    modules,
  });
  const composition = assembleWorldPacks(
    [
      {
        ...localPack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    {
      approvedPermissions: {
        [pack.manifest.id]: [
          ...OVERWORLD_PRODUCT_PERMISSIONS,
          { resource: RESOURCE, operations: ['read', 'write', 'execute'] },
        ],
      },
    },
  );
  voxels.clear();
  voxels.set('4,3,0', Voxel.Grass);
  const world = new GameplayRuntime({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    environmentSeed: 77,
    getWorldTime: () => 6,
    getVoxel: ([x, y, z]) => voxels.get(`${x},${y},${z}`),
    getLoadedVoxel: ([x, y, z]) => voxels.get(`${x},${y},${z}`),
    prepareVoxelEdit: () => {
      throw new Error('navigation must not prepare voxel edits');
    },
  });
  world.spawnPlayer({ id: 'player', position: [4, 4, 0] });
  world.giveItem('player', { itemId: 'map', count: 1 });
  return {
    world,
    capture,
    actorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
  };
};

const request = (world: ReturnType<typeof createWorld>['world']) =>
  world.invokeActorModuleOperation('player', {
    operationId: OPERATION,
    target: { kind: 'entity', entityId: 'player' },
    input: selfInput,
  });

const baseline = (world: ReturnType<typeof createWorld>['world']) => ({
  navigation: world.navigationItems.checkpoint(),
  inventory: world.getInventoryPointerView('player'),
  gameplayRevision: world.gameplayRevision,
});

const expectUnchanged = (world: ReturnType<typeof createWorld>['world'], before: ReturnType<typeof baseline>) => {
  expect(world.navigationItems.checkpoint()).toEqual(before.navigation);
  expect(world.getInventoryPointerView('player')).toEqual(before.inventory);
  expect(world.gameplayRevision).toBe(before.gameplayRevision);
};

it('discards a registered navigation candidate when an after rule vetoes it', () => {
  const { world } = createWorld('veto');
  const before = baseline(world);
  expect(request(world)).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
  expectUnchanged(world, before);
});

it('rejects a forged state.write candidate before changing the navigation owner', () => {
  const { world } = createWorld('forge');
  const before = baseline(world);
  expect(request(world)).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
  expectUnchanged(world, before);
});

it('revalidates prepared navigation commits against current observation, owner and actor lifetimes', () => {
  const prepare = (
    world: ReturnType<typeof createWorld>['world'],
    context: ActorModuleExecutionContext,
    authorizer: RegisteredCommitContext['authorizer'],
  ) => {
    const address = navigationAddress('player');
    const current = world.navigationItems.state.read(address);
    const observed = [{ address, revision: current.revision }];
    const candidate = buildNavigationCandidate(current.value, classicNavigationConfig.policy, selfInput);
    const execution: RegisteredCommitContext = {
      operationId: OPERATION,
      resource: RESOURCE,
      context,
      authorizer,
      candidateValue: candidate,
      effectiveInput: selfInput,
    };
    const prepared = world.navigationItems.state.prepareCommit?.(observed, [{ address, value: candidate }], execution);
    expect(prepared?.ok).toBe(true);
    if (!prepared || !prepared.ok) throw new Error('Expected a prepared navigation commit.');
    return prepared;
  };

  const cases: ReadonlyArray<Readonly<{ name: string; mutate(world: ReturnType<typeof createWorld>['world']): void }>> =
    [
      {
        name: 'selected item changes',
        mutate: (world) => {
          world.giveItem('player', { itemId: 'compass', count: 1 });
          world.entities.actorStateAccess('player').selectedSlot = 1;
        },
      },
      {
        name: 'loaded map color changes',
        mutate: () => voxels.set('4,3,0', Voxel.Sand),
      },
      {
        name: 'navigation owner is restored',
        mutate: (world) => world.navigationItems.restore(world.navigationItems.checkpoint()),
      },
      {
        name: 'actor store lifetime changes at the same actor id',
        mutate: (world) => world.entities.restoreComponentSnapshot(world.createSnapshot().entityStore),
      },
    ];

  for (const testCase of cases) {
    const { world, capture, actorAuthority } = createWorld('capture-reject');
    expect(request(world)).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
    expect(capture.context?.target).toEqual({ kind: 'entity', entityId: 'player' });
    const binding = actorAuthority.forActor('player', 'player');
    expect(binding).toBeDefined();
    const prepared = prepare(world, capture.context!, binding!.authorizer);
    testCase.mutate(world);
    const beforeValidation = baseline(world);
    expect(() => prepared.validate(), testCase.name).toThrow(/navigation-observation-stale/);
    expectUnchanged(world, beforeValidation);
  }
});

it('rechecks validated navigation commits at apply after the selected item changes', () => {
  const { world, capture, actorAuthority } = createWorld('capture-reject');
  world.giveItem('player', { itemId: 'compass', count: 1 });
  expect(request(world)).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
  expect(capture.context?.target).toEqual({ kind: 'entity', entityId: 'player' });
  const binding = actorAuthority.forActor('player', 'player');
  expect(binding).toBeDefined();

  const address = navigationAddress('player');
  const current = world.navigationItems.state.read(address);
  const candidate = buildNavigationCandidate(current.value, classicNavigationConfig.policy, selfInput);
  const prepared = world.navigationItems.state.prepareCommit?.(
    [{ address, revision: current.revision }],
    [{ address, value: candidate }],
    {
      operationId: OPERATION,
      resource: RESOURCE,
      context: capture.context!,
      authorizer: binding!.authorizer,
      candidateValue: candidate,
      effectiveInput: selfInput,
    },
  );
  expect(prepared?.ok).toBe(true);
  if (!prepared || !prepared.ok) throw new Error('Expected a prepared navigation commit.');
  expect(() => prepared.validate()).not.toThrow();

  world.entities.actorStateAccess('player').selectedSlot = 1;
  const afterSelectionChange = baseline(world);
  expect(() => prepared.apply()).toThrow(/navigation-observation-stale/);
  expectUnchanged(world, afterSelectionChange);
  expect(() => prepared.apply()).toThrow();
  expectUnchanged(world, afterSelectionChange);
});
