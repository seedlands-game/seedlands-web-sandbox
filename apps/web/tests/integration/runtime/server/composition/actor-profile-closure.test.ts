import { describe, expect, it } from 'vitest';
import {
  defineContentModule,
  definePack,
  type ActorProfileInput,
  type ActorProfileRegistry,
  type StarterEcologyConfigurationInput,
} from '@seedlands/stdlib/mod-api';
import { assembleWorldPacks } from '@seedlands/stdlib/host';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { GameServer } from '../../../../fixtures/classic/content';
import { pack as overworldPack } from '../../../../../../../playbooks/classic/src/pack';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { testWorldgenExecutableProvider } from '../../../../../../../packages/stdlib/tests/support/worldgen';

const artifact = <Pack extends ReturnType<typeof definePack>>(pack: Pack) => ({
  ...pack,
  integrity: {
    algorithm: 'sha256' as const,
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

const assemble = (pack: ReturnType<typeof definePack>) =>
  assembleWorldPacks([artifact(pack)], {
    approvedPermissions: { [pack.manifest.id]: pack.modules.flatMap((module) => module.descriptor.permissions ?? []) },
  });

describe('per-world actor profile closure', () => {
  it('starts a composed world without first-party ecology, Combat or Needs fallbacks', async () => {
    const content = defineContentModule({
      moduleId: 'test:content',
      items: [
        {
          id: 'test:scrap',
          storageId: 'scrap',
          name: 'Scrap',
          itemType: 'resource',
          stackLimit: 8,
          capabilities: [],
        },
        {
          id: 'test:meal',
          storageId: 'meal',
          name: 'Meal',
          itemType: 'food',
          stackLimit: 8,
          capabilities: [{ type: 'consume', hungerRestore: 2 }],
        },
      ],
      meleeDefinitions: [],
      actorProfiles: [
        {
          archetype: 'night-stalker',
          entityType: 'creature',
          maxHealth: 7,
          navigation: { speed: 0.75, perceptionRange: 4 },
          deathDrop: { itemId: 'test:scrap', count: 1 },
        },
        {
          archetype: 'grazer',
          entityType: 'creature',
          maxHealth: 9,
          navigation: { speed: 0.5, perceptionRange: 3 },
        },
      ],
    });
    const composition = assemble(
      definePack({ id: 'test:minimal-world', version: '1.0.0', kind: 'playbook', modules: [content] }),
    );
    const runtime = await AuthorityRuntime.create({
      epoch: 'actor-profile-minimal',
      seedText: 'actor-profile-minimal',
      platform: testCorePlatform,
      composition,
      worldgenProvider: testWorldgenExecutableProvider,
      initialWorldTime: 9,
      startTimeMs: 0,
      findInitialWorldBootstrap: async () => ({ playerBodyPosition: [0.5, 2, 0.5], starterChunks: [] }),
    });

    expect(runtime.ready().campPosition).toBeUndefined();
    expect(runtime.view().actors).toEqual([]);
    expect(runtime.view().entities.filter((entity) => entity.type === 'world-item')).toEqual([]);

    const actor = runtime.server.spawnAutonomousActor({
      id: 'custom-actor',
      archetype: 'night-stalker',
      position: [0.5, 2, 1.5],
      registration: { hunger: 12 },
    });
    expect(actor).toMatchObject({ type: 'creature', health: 7, maxHealth: 7 });
    expect(runtime.server.gameplayContent.actorProfiles.require('night-stalker')).toMatchObject({
      navigation: { speed: 0.75, perceptionRange: 4 },
      deathDrop: { itemId: 'scrap', count: 1 },
    });
    runtime.server.spawnAutonomousActor({
      id: 'custom-forager',
      archetype: 'grazer',
      position: [0.5, 80, 1.5],
    });
    const meal = runtime.server.spawnWorldItem([0.5, 80, 2.5], { itemId: 'meal', count: 1 });
    expect(runtime.server.observeActor('custom-forager').food).toEqual([
      expect.objectContaining({ entityId: meal.id }),
    ]);
    expect(runtime.server.simulationSnapshot().actors.find(({ entityId }) => entityId === 'custom-actor')?.hunger).toBe(
      12,
    );
    expect(
      runtime.server.applyActorAuthorityAction('custom-actor', { type: 'attack', targetId: runtime.playerId }),
    ).toEqual({
      accepted: false,
      changed: false,
      reason: 'combat-unavailable',
    });
    expect(runtime.server.getEntity(runtime.playerId)?.health).toBe(20);
    runtime.server.advanceGameplayRules(5);
    expect(runtime.server.simulationSnapshot().actors.find(({ entityId }) => entityId === 'custom-actor')?.hunger).toBe(
      12,
    );
  });

  it('clones and freezes actor/ecology input at assembly', () => {
    const deathDrop = { itemId: 'test:scrap', count: 1 };
    const profile = {
      archetype: 'settler' as const,
      entityType: 'creature' as const,
      maxHealth: 7,
      navigation: { speed: 0.75, perceptionRange: 4 },
      deathDrop,
    } satisfies ActorProfileInput;
    const ecology = {
      version: 1 as const,
      actors: [
        { slot: 'forager' as const, idPrefix: 'test-forager', archetype: 'settler' as const, hunger: 1 },
        { slot: 'predator' as const, idPrefix: 'test-predator', archetype: 'settler' as const },
        { slot: 'resident' as const, idPrefix: 'test-resident', archetype: 'settler' as const, hunger: 2 },
      ],
      initialItem: { itemId: 'test:scrap', count: 1 },
    } satisfies StarterEcologyConfigurationInput;
    const composition = assemble(
      definePack({
        id: 'test:frozen-world',
        version: '1.0.0',
        kind: 'playbook',
        modules: [
          defineContentModule({
            moduleId: 'test:frozen-content',
            items: [
              {
                id: 'test:scrap',
                storageId: 'scrap',
                name: 'Scrap',
                itemType: 'resource',
                stackLimit: 8,
                capabilities: [],
              },
            ],
            meleeDefinitions: [],
            actorProfiles: [profile],
            starterEcology: ecology,
          }),
        ],
      }),
    );
    profile.maxHealth = 99;
    profile.navigation.speed = 99;
    deathDrop.count = 7;
    ecology.initialItem.count = 7;
    ecology.actors[0].hunger = 99;

    const profiles = composition.capability<ActorProfileRegistry>('seedlands:actor-profiles');
    expect(profiles.require('settler')).toMatchObject({
      maxHealth: 7,
      navigation: { speed: 0.75, perceptionRange: 4 },
      deathDrop: { itemId: 'scrap', count: 1 },
    });
    expect(profiles.starterEcology).toMatchObject({
      actors: [{ hunger: 1 }, {}, { hunger: 2 }],
      initialItem: { itemId: 'scrap', count: 1 },
    });
    expect(Object.isFrozen(profiles.require('settler').navigation)).toBe(true);
    expect(Object.isFrozen(profiles.starterEcology?.actors)).toBe(true);
  });

  it.each([
    {
      label: 'drop item',
      actorProfiles: [
        {
          archetype: 'settler' as const,
          entityType: 'npc' as const,
          maxHealth: 20,
          navigation: { speed: 1, perceptionRange: 4 },
          deathDrop: { itemId: 'test:missing', count: 1 },
        },
      ],
      defaultPlayerMeleeDefinitionId: undefined,
    },
    { label: 'default player melee', actorProfiles: [], defaultPlayerMeleeDefinitionId: 'missing-melee' },
    {
      label: 'actor melee',
      actorProfiles: [
        {
          archetype: 'settler' as const,
          entityType: 'npc' as const,
          maxHealth: 20,
          navigation: { speed: 1, perceptionRange: 4 },
          meleeDefinitionId: 'missing-melee',
        },
      ],
      defaultPlayerMeleeDefinitionId: undefined,
    },
  ])(
    'rejects an unknown $label reference before world creation',
    ({ actorProfiles, defaultPlayerMeleeDefinitionId }) => {
      expect(() =>
        assemble(
          definePack({
            id: 'test:bad-profile',
            version: '1.0.0',
            kind: 'playbook',
            modules: [
              defineContentModule({
                moduleId: 'test:bad-content',
                items: [],
                meleeDefinitions: [],
                actorProfiles,
                ...(defaultPlayerMeleeDefinitionId ? { defaultPlayerMeleeDefinitionId } : {}),
              }),
            ],
          }),
        ),
      ).toThrow(/unknown/i);
    },
  );

  it('keeps Overworld actor profiles and starter ecology explicit', () => {
    const composition = assemble(overworldPack);
    const profiles = composition.capability<ActorProfileRegistry>('seedlands:actor-profiles');
    expect(profiles.list()).toMatchObject([
      { archetype: 'grazer', entityType: 'creature', maxHealth: 12 },
      { archetype: 'night-stalker', entityType: 'creature', maxHealth: 16, meleeDefinitionId: 'night-stalker-claw' },
      { archetype: 'settler', entityType: 'npc', maxHealth: 20 },
    ]);
    expect(profiles.defaultPlayerMeleeDefinitionId).toBe('unarmed');
    expect(profiles.starterEcology?.initialItem).toEqual({ itemId: 'berry', count: 1 });

    const server = new GameServer({ seedText: 'explicit-overworld', platform: testCorePlatform, composition });
    expect(server.initializeStarterEcology([0, 34, 0])).toMatchObject({ configured: true, initialized: true });
    expect(server.queryEntities().filter((entity) => entity.archetype)).toHaveLength(3);
    expect(server.queryEntities({ type: 'world-item' })).toContainEqual(
      expect.objectContaining({ stack: { itemId: 'berry', count: 1 } }),
    );
    expect(server.queryPois([0, 34, 0], 40, 'camp')).toHaveLength(1);
  });
});
