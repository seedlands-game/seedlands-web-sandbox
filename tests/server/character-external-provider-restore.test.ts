import { expect, it } from 'vitest';
import {
  defineBehaviorCapabilityModule,
  definePack,
  type BehaviorProviderDefinition,
} from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, OVERWORLD_PRODUCT_PERMISSIONS } from '@seedlands/game-core/server/composition/host-api';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { verifiedBehaviorPack } from '../support/behavior-capability-fixtures';
import { testCorePlatform } from '../support/core-platform';

const MODULE_ID = 'example:restore-provider';
const MODULE_VERSION = '1.2.0';
const CAPABILITY_ID = 'example:continue-after-restore';
const CAPABILITY_VERSION = '1.0.0';

it('restores an external running capability whose module and capability versions differ without replaying start', async () => {
  let starts = 0;
  let continues = 0;
  const capability: BehaviorProviderDefinition = {
    kind: 'skill',
    id: CAPABILITY_ID,
    version: CAPABILITY_VERSION,
    description: 'Starts once and finishes on the next behavior step.',
    arguments: {},
    requiredOperations: [],
    state: {
      version: '1.0.0',
      maximumBytes: 32,
      validate: (value) =>
        Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'step' in value && value.step === 1),
    },
    start() {
      starts++;
      return { status: 'running', phase: 'started', state: { step: 1 } };
    },
    continue() {
      continues++;
      return { status: 'succeeded', phase: 'finished', result: { step: 2 } };
    },
  };
  const behavior = defineBehaviorCapabilityModule({
    id: MODULE_ID,
    version: MODULE_VERSION,
    permissions: [],
    capabilities: [capability],
  });
  const extension = definePack({
    id: 'example:restore-pack',
    version: '1.0.0',
    kind: 'extension',
    dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
    modules: [behavior],
  });
  const createComposition = () =>
    assembleWorldPacks([verifiedBehaviorPack(overworld), verifiedBehaviorPack(extension)], {
      approvedPermissions: {
        'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS,
        'example:restore-pack': [],
      },
    });
  const session = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'external-provider-restore',
    createComposition,
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const created = await session.world.character({
      kind: 'create',
      profile: { name: 'Restore', personality: 'Patient' },
      position: [1.5, 34, 0.5],
      behaviorTree: {
        goal: { description: 'Continue external work after restore.' },
        definition: { version: 1, root: { id: 'external-work', type: 'action', skill: CAPABILITY_ID } },
      },
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('External behavior actor was not created.');
    const entityId = created.data.character.entityId;
    expect(await session.world.clock({ kind: 'advance', elapsedMs: 100 })).toMatchObject({ ok: true });
    expect({ starts, continues }).toEqual({ starts: 1, continues: 0 });
    const checkpoint = await session.world.checkpoint({ kind: 'export' });
    if (!checkpoint.ok || !checkpoint.data.snapshot) throw new Error('External behavior checkpoint unavailable.');
    const execution = checkpoint.data.snapshot.gameplay.entityStore.actors
      .find((actor) => actor.entityId === entityId)
      ?.character?.behaviorTree.skills.find((skill) => skill.nodeId === 'external-work');
    expect(execution).toMatchObject({
      status: 'running',
      providerId: CAPABILITY_ID,
      providerVersion: CAPABILITY_VERSION,
      providerModuleId: MODULE_ID,
      stateVersion: '1.0.0',
      providerState: { step: 1 },
    });
    if (!execution) throw new Error('External behavior execution checkpoint unavailable.');

    for (const mutate of [
      (skill: typeof execution) => (skill.providerVersion = '9.0.0'),
      (skill: typeof execution) => (skill.providerModuleId = 'example:wrong-provider'),
      (skill: typeof execution) => (skill.stateVersion = '9.0.0'),
      (skill: typeof execution) => (skill.providerState = { step: 9 }),
    ]) {
      const corrupted = testCorePlatform.clone(checkpoint.data.snapshot);
      const skill = corrupted.gameplay.entityStore.actors
        .find((actor) => actor.entityId === entityId)!
        .character!.behaviorTree.skills.find((entry) => entry.nodeId === 'external-work')!;
      mutate(skill);
      expect(await session.world.checkpoint({ kind: 'restore', snapshot: corrupted })).toMatchObject({ ok: false });
      expect({ starts, continues }).toEqual({ starts: 1, continues: 0 });
    }

    expect(await session.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(await session.world.clock({ kind: 'advance', elapsedMs: 100 })).toMatchObject({ ok: true });
    expect({ starts, continues }).toEqual({ starts: 1, continues: 1 });
    const observed = await session.world.character({ kind: 'observe', entityId });
    expect(observed).toMatchObject({
      ok: true,
      data: {
        observation: {
          character: {
            behaviorTree: {
              runtime: { skills: [expect.objectContaining({ nodeId: 'external-work', status: 'succeeded' })] },
            },
          },
        },
      },
    });
  } finally {
    await session.dispose();
  }
});
