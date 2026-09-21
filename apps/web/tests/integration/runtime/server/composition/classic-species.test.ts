import { expect, it } from 'vitest';
import { pack, pack as overworldPack } from '@seedlands/playbook-classic';
import { definePack } from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks } from '@seedlands/stdlib/host';
import type { ActorProfileRegistry } from '@seedlands/stdlib/server/gameplay/actor-profile';
import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';
import { getItemDefinition } from '../../../../fixtures/classic/content';
import { GameServer, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const expected = [
  ['chicken', 4, 'feather'],
  ['cow', 10, 'leather'],
  ['pig', 10, 'raw-porkchop'],
  ['sheep', 8, 'wool'],
  ['squid', 10, 'ink-sac'],
  ['wolf', 8, undefined],
  ['zombie', 20, 'rotten-flesh'],
  ['skeleton', 20, 'bone'],
  ['spider', 16, 'string'],
  ['creeper', 20, 'gunpowder'],
  ['slime', 16, 'slimeball'],
] as const;
const artifact = (candidate: ReturnType<typeof definePack>) => ({
  ...candidate,
  integrity: {
    algorithm: 'sha256' as const,
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

it('所有主世界物种经正式 GameServer 生成并进入同一快照', () => {
  const server = new GameServer({ seedText: 'classic-species', platform: testCorePlatform, ...classicOptions() });
  expected.forEach(([archetype, maxHealth], index) => {
    expect(
      server.spawnAutonomousActor({ id: 'species-' + archetype, archetype, position: [index * 2, 40, 0] }),
    ).toMatchObject({
      type: 'creature',
      archetype,
      health: maxHealth,
      maxHealth,
      persistent: true,
    });
  });
  const entities = server.queryEntities();
  const simulation = server.simulationSnapshot();
  for (const [archetype] of expected) {
    expect(entities).toContainEqual(expect.objectContaining({ id: 'species-' + archetype, archetype }));
    expect(simulation.actors).toContainEqual(expect.objectContaining({ entityId: 'species-' + archetype, archetype }));
  }
});
const assemble = (candidate: ReturnType<typeof definePack>) =>
  assembleWorldPacks([artifact(candidate)], {
    approvedPermissions: {
      [candidate.manifest.id]: candidate.modules.flatMap((module) => module.descriptor.permissions ?? []),
    },
  });

it('Classic 主世界物种具有独立 profile、生命、掉落与身体配置', () => {
  expect(pack).toBe(overworldPack);
  const profiles = assemble(pack).capability<ActorProfileRegistry>('seedlands:actor-profiles');
  for (const [archetype, maxHealth, drop] of expected) {
    const profile = profiles.require(archetype);
    expect(profile).toMatchObject({ archetype, entityType: 'creature', maxHealth });
    expect(profile.deathDrop?.itemId).toBe(drop);
    expect(bodyConfigFor(archetype).localAabb.max.y).toBeGreaterThan(0);
    if (drop) expect(getItemDefinition(drop)).toBeDefined();
  }
  expect(profiles.require('zombie').disposition).toBe('hostile');
  expect(profiles.require('cow').disposition).toBe('passive');
  expect(profiles.require('wolf').disposition).toBe('neutral');
});
