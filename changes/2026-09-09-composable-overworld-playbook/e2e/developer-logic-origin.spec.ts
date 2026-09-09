import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HeadlessSession } from '../../../packages/game-core/src/server/headless/headless-session';
import { assembleOverworldPacks, type VerifiedPackArtifact } from '@seedlands/game-core/server/composition/host-api';
import {
  DEVELOPER_WORLD_SUBJECT,
  developmentWorldAuthorizationPolicy,
} from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../../tests/support/core-platform';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

test('Browser 脚本攻击保留开发者来源，并在 Headless 换 alias 恢复时按当前权限结算', async ({ page }) => {
  test.setTimeout(90_000);
  await startHarnessWorld(page, 'developer-logic-origin');
  const saved = await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    await world.clock({ kind: 'pause' });
    await world.logic({ kind: 'mode', mode: 'scripted' });
    for (const command of [
      {
        type: 'fill' as const,
        from: [-2, 59, -2] as [number, number, number],
        to: [2, 59, 3] as [number, number, number],
        voxel: 3,
      },
      {
        type: 'fill' as const,
        from: [-2, 60, -2] as [number, number, number],
        to: [2, 64, 3] as [number, number, number],
        voxel: 0,
      },
      { type: 'teleport' as const, position: [0.5, 60, 0.5] as [number, number, number] },
      {
        type: 'spawn-actor' as const,
        id: 'scripted-hunter',
        archetype: 'night-stalker' as const,
        position: [0.5, 60, 1.5] as [number, number, number],
      },
    ]) {
      const result = await world.command(command);
      if (!result.ok || !result.data.success) throw new Error(JSON.stringify(result));
    }
    const observed = await world.logic({ kind: 'observe' });
    if (!observed.ok || !('observation' in observed.data) || !observed.data.observation)
      throw new Error('No observation.');
    const observation = observed.data.observation;
    const actor = observation.entities.find((entity) => entity.id === 'scripted-hunter')!;
    const player = observation.entities.find((entity) => entity.bodyKind === 'player')!;
    const submitted = await world.logic({
      kind: 'submit',
      batch: {
        protocolVersion: 1,
        epoch: observation.epoch,
        observationSequence: observation.observationSequence,
        expiresAtPhysicsTick: observation.physicsTick + 12,
        intents: [
          {
            entityId: actor.id,
            identityRevision: actor.identityRevision,
            observedPoseRevision: actor.poseRevision,
            readChunkRevisions: [],
            wish: { x: 0, z: 0 },
            jumpRequested: false,
            verticalIntent: 0,
            action: { type: 'attack', targetId: player.id },
          },
        ],
      },
    });
    if (!submitted.ok) throw new Error(JSON.stringify(submitted));
    const exported = await world.checkpoint({ kind: 'export' });
    if (!exported.ok || !exported.data.snapshot) throw new Error('No checkpoint.');
    return { checkpoint: exported.data.snapshot, playerId: player.id, health: player.health };
  });
  const loader = (await import(pathToFileURL(resolve('scripts/pack-integrity.mjs')).href)) as {
    loadVerifiedPackArtifacts(path: string): Promise<readonly VerifiedPackArtifact[]>;
  };
  const artifacts = await loader.loadVerifiedPackArtifacts(resolve('apps/web/public/packs/packs.lock.json'));
  const createComposition = () => assembleOverworldPacks(artifacts);
  for (const allowed of [true, false]) {
    const policy = developmentWorldAuthorizationPolicy('restored-developer-alias');
    const session = await HeadlessSession.create({
      seedText: 'developer-restore-target',
      platform: testCorePlatform,
      createComposition,
      worldHarness: {
        principalId: 'restored-developer-alias',
        authorization: allowed
          ? policy
          : {
              principals: policy.principals,
              rules: [{ effect: 'allow', resources: ['world.checkpoint'], operations: ['restore'], scope: 'any' }],
            },
      },
    });
    try {
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: saved.checkpoint })).toMatchObject({
        ok: true,
      });
      const active = session.runtime.server
        .simulationSnapshot()
        .combat?.combatants.find((entry) => entry.actorId === 'scripted-hunter')?.combat.active;
      if (allowed)
        expect(active).toMatchObject({
          origin: { principalSubject: DEVELOPER_WORLD_SUBJECT, originalActor: { entityId: 'scripted-hunter' } },
        });
      else expect(active).toBeNull();
      session.runtime.server.advanceGameplayRules(0.3);
      expect(session.runtime.server.getEntity(saved.playerId)!.health).toBe(saved.health! - (allowed ? 2 : 0));
    } finally {
      await session.dispose();
    }
  }
  const browser = await page.evaluate(
    async ({ checkpoint, playerId }) => {
      const world = window.__seedlandsHarness!.world;
      const restored = await world.checkpoint({ kind: 'restore', snapshot: checkpoint });
      if (!restored.ok) throw new Error(JSON.stringify(restored));
      await world.clock({ kind: 'advance', elapsedMs: 300 });
      return world.inspect({ kind: 'entity', entityId: playerId });
    },
    { checkpoint: saved.checkpoint, playerId: saved.playerId },
  );
  expect(browser).toMatchObject({ ok: true, data: { entity: { health: saved.health! - 2 } } });
});

test('Browser 未启用 Developer World Harness 时拒绝脚本 Logic RPC', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      if (message && typeof message === 'object' && 'kind' in message && message.kind === 'start-authority')
        message = { ...message, developerWorldHarness: false };
      send.call(this, message, Array.isArray(options) ? { transfer: options } : options);
    };
  });
  await startHarnessWorld(page, 'developer-logic-disabled');
  const result = await page.evaluate(() => window.__seedlandsHarness!.world.logic({ kind: 'mode', mode: 'scripted' }));
  expect(result).toMatchObject({ ok: false, error: { kind: 'permission' } });
});
