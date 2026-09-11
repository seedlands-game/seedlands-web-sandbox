import type { WorldComposition } from './contracts';
import { WorldResourceAuthorizer } from '../harness/world-authorization';
import type { ModuleSystemAuthority } from '../gameplay/modules/gameplay-module-schedule';
import { FORAGE_RESOURCE } from '../gameplay/modules/forage-model';

/** Explicit product host policy; module permission requests never add grants here. */
export function createGameplaySystemAuthority(composition: WorldComposition): ModuleSystemAuthority {
  const principalId = 'gameplay-schedule';
  return {
    principalId,
    authorizer: new WorldResourceAuthorizer(
      {
        principals: [{ id: principalId, kind: 'system', subject: 'seedlands:world-schedule' }],
        rules: [
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: [
              'seedlands.needs',
              'seedlands.combat-clock',
              'seedlands.block-clock',
              'seedlands.furnace-clock',
            ],
            operations: ['read', 'write', 'execute'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: ['seedlands.ruleset'],
            operations: ['read'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: [FORAGE_RESOURCE],
            operations: ['read', 'execute'],
            scope: 'any',
          },
        ],
      },
      composition.resources,
    ),
  };
}
