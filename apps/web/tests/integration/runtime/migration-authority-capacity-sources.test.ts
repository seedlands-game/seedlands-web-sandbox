import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import {
  BLOCK_BEGIN_OPERATION,
  BLOCK_CANCEL_OPERATION,
} from '../../../../../packages/stdlib/src/server/gameplay/modules/block-action-model';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { WorldResourceAuthorizer } from '../../../../../packages/stdlib/src/server/harness/world-authorization';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { classicOptions, GameServer } from '../../fixtures/classic/content';

const profile = { name: 'Capacity Settler', personality: 'Patient.', riskTolerance: 0.25 } as const;

function createGameplay(id: string) {
  return new GameplayRuntime({
    ...classicOptions(),
    getVoxel: () => 0,
    getLoadedVoxel: () => 0,
    prepareVoxelEdit: () => ({ committed: false }) as never,
    getWorldTime: () => 9,
    platform: testCorePlatform,
    worldId: id,
  });
}

describe('Authority Gameplay commit capacity sources', () => {
  it('bounds all due Classic scheduled systems before their real commits', () => {
    const gameplay = createGameplay('migration:capacity-schedule');
    gameplay.spawnPlayer({ id: 'player-1', position: [0.5, 1, 0.5] });
    const upperBound = gameplay.advanceCommitUpperBound(1);
    const before = gameplay.kernelState.commitSequence;

    gameplay.advanceRules(1);

    expect(upperBound).toBeGreaterThan(1);
    expect(gameplay.kernelState.commitSequence - before).toBeLessThanOrEqual(upperBound);
    gameplay.dispose();
  });

  it('includes a completed registered Block settlement in the preflight bound', () => {
    const server = new GameServer({
      seedText: 'migration-capacity-block',
      platform: testCorePlatform,
      ...classicOptions(),
    });
    const position: [number, number, number] = [2, 60, 0];
    server.editBatch({ actorId: 'setup', edits: [{ x: 2, y: 60, z: 0, value: Voxel.Wood }] });
    server.spawnPlayer({ id: 'alice', position: [0.5, 60, 0.5] });
    expect(server.beginBreak('alice', position).success).toBe(true);
    const upperBound = server.gameplayAdvanceCommitUpperBound(1.2);
    const before = server.commitSequence;

    const result = server.advanceGameplayRules(1.2);

    expect(result.commits).toHaveLength(1);
    expect(server.commitSequence - before).toBeLessThanOrEqual(upperBound);
  });

  it('bounds queued Block begins that are settled during the same advance', () => {
    const options = classicOptions();
    const server = new GameServer({
      seedText: 'migration-capacity-queued-blocks',
      platform: testCorePlatform,
      ...options,
    });
    const count = 64;
    const targets = Array.from({ length: count }, (_, index) => {
      const x = 2 + (index % 8) * 4;
      const z = Math.floor(index / 8) * 4;
      return [x, 60, z] as const;
    });
    server.editBatch({
      actorId: 'setup',
      edits: targets.map(([x, y, z]) => ({ x, y, z, value: Voxel.Wood })),
    });
    const executions = targets.map((position, index) => {
      const id = `miner-${index}`;
      server.spawnPlayer({ id, position: [position[0] - 1.5, position[1], position[2] + 0.5] });
      const principalId = `principal-${index}`;
      const authorizer = new WorldResourceAuthorizer(
        {
          principals: [{ id: principalId, subject: 'seedlands:local-player', kind: 'actor', boundEntityId: id }],
          rules: [
            {
              effect: 'allow',
              resources: options.composition.resources.map((resource) => resource.id),
              operations: ['read', 'write', 'execute'],
              scope: 'any',
            },
          ],
        },
        options.composition.resources,
      );
      const execution = server.bindModuleOperations(authorizer, {
        moduleId: 'seedlands:block-actions-module',
        principalId,
        originalActorId: id,
      });
      const begin = {
        operationId: BLOCK_BEGIN_OPERATION,
        target: { kind: 'voxel' as const, position: [...position] as [number, number, number] },
        input: { position: [...position] as [number, number, number] },
      };
      expect(execution.invoke(begin).ok).toBe(true);
      expect(server.getPlayerState(id).breakAction).not.toBeNull();
      let unsubscribe = () => {};
      let queued = false;
      unsubscribe = execution.subscribe((fact, enqueue) => {
        if (fact.operationId !== BLOCK_CANCEL_OPERATION) return;
        queued = enqueue(begin);
        unsubscribe();
      });
      expect(
        execution.invoke({
          operationId: BLOCK_CANCEL_OPERATION,
          target: { kind: 'entity', entityId: id },
        }).ok,
      ).toBe(true);
      expect(queued).toBe(true);
      expect(server.getPlayerState(id).breakAction).toBeNull();
      return execution;
    });
    const upperBound = server.gameplayAdvanceCommitUpperBound(1.2);
    const before = server.commitSequence;

    server.advanceGameplayRules(1.2);

    expect(server.commitSequence - before).toBeLessThanOrEqual(upperBound);
    expect(targets.filter((position) => server.getVoxel(...position) !== Voxel.Air)).toEqual([]);
    executions.forEach((execution) => execution.dispose());
    server.disposeGameplay();
  });

  it('includes multiple pending registered Combat settlements in the preflight bound', () => {
    const gameplay = createGameplay('migration:capacity-combat');
    gameplay.spawnPlayer({ id: 'alice', position: [0, 0, 0] });
    for (const [id, x] of [
      ['wolf-1', 1],
      ['wolf-2', -1],
    ] as const)
      gameplay.spawnAutonomous(
        { id, type: 'creature', archetype: 'night-stalker', position: [x, 0, 0] },
        { archetype: 'night-stalker' },
      );
    expect(gameplay.simulation.requestActorCombat('wolf-1', 'alice', 'night-stalker-claw').success).toBe(true);
    expect(gameplay.simulation.requestActorCombat('wolf-2', 'alice', 'night-stalker-claw').success).toBe(true);
    const upperBound = gameplay.advanceCommitUpperBound(0.3);
    const before = gameplay.kernelState.commitSequence;

    gameplay.advanceRules(0.3);

    expect(gameplay.getEntity('alice')?.health).toBeLessThan(20);
    expect(gameplay.kernelState.commitSequence - before).toBeLessThanOrEqual(upperBound);
    gameplay.dispose();
  });

  it('includes Character behavior transitions in the same advance bound', () => {
    const gameplay = createGameplay('migration:capacity-character');
    gameplay.spawnPlayer({ id: 'alice', position: [0, 0, 0] });
    const created = gameplay.character({ kind: 'create', profile, position: [2, 0, 0] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const upperBound = gameplay.advanceCommitUpperBound(0.2);
    const before = gameplay.kernelState.commitSequence;

    gameplay.advanceRules(0.2);

    expect(gameplay.kernelState.commitSequence).toBeGreaterThan(before);
    expect(gameplay.kernelState.commitSequence - before).toBeLessThanOrEqual(upperBound);
    gameplay.dispose();
  });
});
