import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { GameplayRuntime } from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import { GameServer } from '@seedlands/stdlib/server/game-server';
import { classicContent, createClassicComposition } from '../../fixtures/classic/content';
import { createGameplayKernelRuntime } from '@seedlands/stdlib/host';
import { defineModule, type KernelValue } from '@seedlands/kernel';
import { Inventory } from '@seedlands/stdlib/server/gameplay/inventory';

describe('production Kernel runtime ownership', () => {
  it('runs real inventory state through the same registered runtime and clock owner', () => {
    const composition = createClassicComposition();
    const runtime = new GameplayRuntime({
      composition,
      getVoxel: () => 0,
      prepareVoxelEdit: () => ({ committed: false }) as never,
      getWorldTime: () => 9,
      platform: testCorePlatform,
      worldId: 'migration:inventory-world',
    });
    runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const before = runtime.kernelState.gameplayRevision;
    expect(runtime.giveItem('player', { itemId: 'berry', count: 2 })).toMatchObject({ success: true });
    const projection = runtime.kernelRuntime
      .componentStorage<readonly unknown[]>('seedlands:inventory-state')
      .read('player');
    expect(projection?.[0]).toEqual({ itemId: 'berry', count: 2 });
    expect(runtime.kernelState).toBe(runtime.kernelRuntime.stateOwner);
    expect(runtime.kernelState.gameplayRevision).toBeGreaterThan(before);
    expect(runtime.kernelRuntime.definitions.stateCodecs.size).toBeGreaterThan(1);
    expect(runtime.kernelRuntime.definitions.operations.has('seedlands:inventory-move')).toBe(true);
  });

  it('owns a registered counter and the real inventory store in one production Kernel runtime', () => {
    const counterModule = defineModule({
      id: 'test:counter-module',
      version: '1.0.0',
      moduleStates: [
        {
          id: 'test:counter',
          moduleId: 'test:counter-module',
          codec: {
            version: 1,
            encode: (state: { value: number }) => ({ value: state.value }),
            decode: (value: KernelValue) => {
              if (!value || Array.isArray(value) || typeof value !== 'object')
                throw new TypeError('Counter state is invalid.');
              const record = value as Readonly<Record<string, KernelValue>>;
              if (typeof record.value !== 'number') throw new TypeError('Counter state is invalid.');
              return { value: record.value };
            },
          },
          create: () => ({ value: 0 }),
          dispose: () => undefined,
        },
      ],
    });
    const owner = createGameplayKernelRuntime(classicContent, undefined, 'migration:counter-inventory', [
      counterModule,
    ]);
    owner.entities.spawn({ id: 'player', type: 'player', position: [0, 1, 0] });
    const actor = owner.entities.get('player')!;
    const components = owner.entities.actorComponentSnapshot('player');
    const inventory = new Inventory(components.inventory.length, components.inventory, classicContent.items);
    inventory.add({ itemId: 'berry', count: 2 });
    const mutation = owner.entities.prepareMutation({
      actors: [
        {
          reference: owner.entities.createReference('player')!,
          health: actor.health!,
          components: { ...components, inventory: inventory.snapshot() },
        },
      ],
    });
    mutation.validate();
    mutation.apply();
    owner.runtime.state<{ value: number }>('test:counter').value += 1;

    expect(owner.runtime.componentStorage<readonly unknown[]>('seedlands:inventory-state').read('player')?.[0]).toEqual(
      { itemId: 'berry', count: 2 },
    );
    expect(owner.runtime.state<{ value: number }>('test:counter').value).toBe(1);
    expect(owner.runtime.checkpoint().modules.map(({ id }) => id)).toEqual([
      'seedlands:authority-session-state',
      'seedlands:entity-state',
      'test:counter',
    ]);
    owner.runtime.dispose();
  });

  it('restores the EntityStore into the same shared instance used by component projections', () => {
    const source = createGameplayKernelRuntime(classicContent, undefined, 'migration:shared-restore');
    source.entities.spawn({ id: 'player', type: 'player', position: [0, 1, 0] });
    source.entities.actorStateAccess('player').inventory.add({ itemId: 'berry', count: 2 });
    const checkpoint = source.runtime.checkpoint();
    source.runtime.dispose();

    const restored = createGameplayKernelRuntime(classicContent, undefined, 'migration:shared-restore', [], checkpoint);
    expect(restored.entities.get('player')).not.toBeNull();
    expect(
      restored.runtime.componentStorage<readonly unknown[]>('seedlands:inventory-state').read('player')?.[0],
    ).toEqual({ itemId: 'berry', count: 2 });
    restored.runtime.dispose();
  });

  it('routes GameServer lazy generation through its executable provider and rejects a missing provider', () => {
    let generated = 0;
    const identity = {
      id: 'test:marked-worldgen',
      implementationVersion: '1.0.0',
      configurationIdentity: 'marker-three',
      supportedGeneratorVersions: [4],
      artifactIdentity: 'test-artifact',
    } as const;
    const provider = {
      identity,
      generate(input: Parameters<import('@seedlands/kernel/spatial').KernelWorldgenProvider['generate']>[0]) {
        generated += 1;
        return { ...input, provider: identity, voxels: new Uint16Array(32 ** 3).fill(3) };
      },
      sampleVoxel: () => 3,
    };
    const server = new GameServer({
      seedText: 'marked-provider',
      platform: testCorePlatform,
      content: classicContent,
      worldgenProvider: provider,
    });
    expect(server.getVoxel(0, 0, 0)).toBe(3);
    expect(generated).toBe(1);
    server.disposeGameplay();

    const missing = new GameServer({
      seedText: 'missing-provider',
      platform: testCorePlatform,
      content: classicContent,
    });
    expect(() => missing.getVoxel(0, 0, 0)).toThrow('no world-generation provider');
    missing.disposeGameplay();
  });

  it('rejects an identity-free legacy snapshot before replacing composed gameplay state', () => {
    const composition = createClassicComposition();
    const runtime = new GameplayRuntime({
      composition,
      getVoxel: () => 0,
      prepareVoxelEdit: () => ({ committed: false }) as never,
      getWorldTime: () => 9,
      platform: testCorePlatform,
      worldId: 'migration:legacy-admission',
    });
    runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    runtime.giveItem('player', { itemId: 'berry', count: 2 });
    const before = runtime.createSnapshot();
    const epoch = runtime.kernelState.epoch;

    expect(() => runtime.restoreSnapshot({ version: 3, revision: 0, gameplayTime: 0 })).toThrow(
      /legacy gameplay composition identity is unavailable/i,
    );
    expect(runtime.createSnapshot()).toEqual(before);
    expect(runtime.kernelState.epoch).toBe(epoch);
    runtime.dispose();
  });
});
