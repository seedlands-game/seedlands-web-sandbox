import { describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { AuthorityLogicObservationBuilder } from '../../packages/game-core/src/server/authority/logic-observation-builder';
import { selectAuthorityPhysicsInput } from '../../packages/game-core/src/server/authority/authority-physics-input';
import { InputCommandBuffer } from '../../packages/game-core/src/runtime/session-protocol';
import type { LogicIntent } from '../../packages/game-core/src/server/authority/authority-session';
import { testCorePlatform } from '../support/core-platform';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';

describe('authority entity lifetime checkpoints', () => {
  it('changes observation identity when gameplay restores the same ID and archetype', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, persistence, seedText: 'lifetime-observation' });
    server.spawnPlayer({ id: 'player', position: [0, 40, 0] });
    server.spawnAutonomousActor({ id: 'actor', archetype: 'grazer', position: [2, 40, 0] });
    const builder = new AuthorityLogicObservationBuilder(testCorePlatform.clone, 'session', server);
    const before = builder.identityRevision(server.getEntity('actor')!);
    await server.save();
    await server.restore();
    expect(builder.identityRevision(server.getEntity('actor')!)).not.toBe(before);
  });

  it('rechecks a retained movement intent reference at the physics execution checkpoint', () => {
    const entity = { id: 'actor', type: 'creature' as const, position: [0, 1, 0] as [number, number, number] };
    const reference = { entityId: 'actor', epoch: 1, lifetime: 1 };
    const intent = {
      entityId: 'actor',
      entityReference: reference,
      wish: { x: 1, z: 0 },
      jumpRequested: true,
      verticalIntent: 0 as const,
      expiresAtPhysicsTick: 20,
    };
    const intents = new Map<string, LogicIntent>([['actor', intent]]);
    const input = new InputCommandBuffer('session', 'player-input').consumeForTick(1);
    const selected = selectAuthorityPhysicsInput(entity, 'player', input, intents, 1, () => false);
    expect(selected.wish).toEqual({ x: 0, z: 0 });
    expect(selected.jumpPressed).toBe(false);
    expect(intents.has('actor')).toBe(false);
  });

  it('revokes the old player control binding after an in-place gameplay restore', async () => {
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'old-control',
      seedText: 'old-control',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0, 40, 0],
    });
    await runtime.server.save();
    await runtime.server.restore();
    expect(
      runtime.receiveInput({
        kind: 'input',
        protocolVersion: 1,
        epoch: 'old-control',
        stream: 'player-input',
        sequence: 1,
        targetPhysicsTick: 1,
        issuedAtMs: 0,
        state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: false },
        edges: { jumpPressed: false },
      }),
    ).toBe('wrong-epoch');
    const result = await runtime.performAction({ type: 'select-hotbar', slot: 1 });
    expect(result.result).toMatchObject({ success: false, reason: 'stale-control-binding' });
    expect(runtime.server.getPlayerState(runtime.playerId).selectedSlot).toBe(0);
  });
});
