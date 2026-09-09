import { expect, it } from 'vitest';
import { definePack, defineBlockRulesModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks } from '@seedlands/game-core/server/composition/host-api';
import { GameServer } from '../../../packages/game-core/src/server/game-server';
import { executeGameplayCommand } from '../../../packages/game-core/src/server/commands/gameplay-command-handler';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { testCorePlatform } from '../../support/core-platform';

function world(hardness: number, omitRules = false) {
  const definitions = [
    {
      voxel: 3,
      hardnessSeconds: hardness,
      preferredTool: 'pickaxe' as const,
      drop: { itemId: 'stone-block', count: 1 },
      replaceable: false,
    },
  ];
  const rules = defineBlockRulesModule({ moduleId: 'test:block-rules', voxelDefinitions: definitions });
  const modules = pack.modules.flatMap((module) =>
    module.descriptor.id === 'seedlands:overworld-block-rules' ? (omitRules ? [] : [rules]) : [module],
  );
  const root = definePack({ id: 'test:block-world', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...root,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:block-world': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const server = new GameServer({ seedText: 'block-content', platform: testCorePlatform, composition });
  return { server, definitions };
}

it('queries the selected immutable Block definitions of each actual world', async () => {
  const a = world(7),
    b = world(11);
  a.definitions[0].hardnessSeconds = 999;
  a.definitions[0].drop.count = 9;
  const query = (server: GameServer) =>
    executeGameplayCommand(
      server,
      { actorId: 'query', sourceType: 'console', capabilities: [] },
      { type: 'query-voxel-definitions' },
    );
  expect((await query(a.server)).data).toEqual({
    voxels: [
      {
        voxel: 3,
        hardnessSeconds: 7,
        preferredTool: 'pickaxe',
        drop: { itemId: 'stone-block', count: 1 },
        replaceable: false,
      },
    ],
  });
  expect((await query(b.server)).data).toEqual({
    voxels: [
      {
        voxel: 3,
        hardnessSeconds: 11,
        preferredTool: 'pickaxe',
        drop: { itemId: 'stone-block', count: 1 },
        replaceable: false,
      },
    ],
  });
});

it('requires explicit Block definitions instead of selecting the Overworld implicitly', () => {
  const malformed = { moduleId: 'test:no-content' } as Parameters<typeof defineBlockRulesModule>[0];
  expect(() => defineBlockRulesModule(malformed)).toThrow(/definitions/i);
});

it('does not report default Block content when the world omits the Rules provider', async () => {
  const { server } = world(7, true);
  await expect(
    executeGameplayCommand(
      server,
      { actorId: 'query', sourceType: 'console', capabilities: [] },
      { type: 'query-voxel-definitions' },
    ),
  ).rejects.toThrow(/capability.*not registered/i);
});
