import { expect, it } from 'vitest';
import { parseSlashCommand } from '../../../packages/game-core/src/server/commands/slash-command-parser';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { testCorePlatform } from '../../support/core-platform';

const createComposition = () =>
  assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256' as const,
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
it('parses bounded mode controls and rejects malformed options', () => {
  expect(parseSlashCommand('/gamemode creative')).toEqual({
    success: true,
    command: { type: 'set-mode', mode: 'creative' },
  });
  expect(parseSlashCommand('/fly off')).toEqual({ success: true, command: { type: 'set-flight', enabled: false } });
  expect(parseSlashCommand('/creative-slot 2 wood-block')).toEqual({
    success: true,
    command: { type: 'set-creative-slot', slot: 2, itemId: 'wood-block' },
  });
  for (const input of ['/gamemode admin', '/fly maybe', '/creative-slot 8 wood-block'])
    expect(parseSlashCommand(input).success).toBe(false);
});
it('executes through an ordinary self principal in the actual Headless Harness', async () => {
  const session = await HeadlessSession.create({
    seedText: 'mode-self',
    platform: testCorePlatform,
    createComposition,
    worldHarness: {
      principalId: 'human',
      authorization: {
        principals: [{ id: 'human', boundEntityId: 'ordinary' }],
        rules: [
          { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
          {
            effect: 'allow',
            principal: { ids: ['human'] },
            resources: ['seedlands.mode'],
            operations: ['read', 'write', 'execute'],
            scope: 'self',
          },
        ],
      },
    },
  });
  try {
    session.runtime.server.spawnPlayer({
      id: 'ordinary',
      position: [...session.runtime.server.getEntity(session.runtime.playerId)!.position],
    });
    expect(await session.world.command({ type: 'set-mode', mode: 'creative' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect(session.runtime.server.getActorModeState('ordinary')).toMatchObject({
      mode: 'creative',
      flight: { enabled: true },
    });
    expect(await session.world.command({ type: 'set-flight', enabled: false })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    expect(session.runtime.server.getActorModeState('ordinary')!.flight.enabled).toBe(false);
  } finally {
    await session.dispose();
  }
}, 15_000);
it('actual authority publishes flight and rejects input captured before a mode change', async () => {
  const session = await HeadlessSession.create({
    seedText: 'mode-physics',
    platform: testCorePlatform,
    createComposition,
  });
  try {
    const before = session.runtime.snapshot();
    expect(await session.world.command({ type: 'set-mode', mode: 'creative' })).toMatchObject({
      ok: true,
      data: { success: true },
    });
    const current = session.runtime.snapshot();
    expect(current.player.movement?.flightSpeed).toBeGreaterThan(0);
    const input = {
      kind: 'input' as const,
      protocolVersion: 1 as const,
      epoch: current.epoch,
      stream: 'player-input',
      sequence: 1,
      targetPhysicsTick: current.physicsTick + 1,
      issuedAtMs: 1,
      movementRevision: before.player.movement?.revision,
      state: { moveX: 0, moveZ: 0, verticalIntent: 1 as const, jumpHeld: true },
      edges: { jumpPressed: false },
    };
    expect(session.runtime.receiveInput(input)).toBe('invalid');
    expect(session.runtime.receiveInput({ ...input, movementRevision: current.player.movement!.revision })).toBe(
      'accepted',
    );
    const y = session.runtime.server.getEntity(session.runtime.playerId)!.position[1];
    await session.advancePhysics(3);
    expect(session.runtime.server.getEntity(session.runtime.playerId)!.position[1]).toBeGreaterThan(y);
  } finally {
    await session.dispose();
  }
}, 15_000);
