import { createGameplaySystemAuthority } from '../composition/gameplay-system-authority';
import { createGameplayActorAuthority } from '../composition/gameplay-actor-authority';
import type { WorldComposition } from '../composition/contracts';
import { WorldResourceAuthorizer, type WorldAuthorizationPolicy } from '../harness/world-authorization';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import type { WorldModuleBinding } from '../commands/module-command';
import type { ServerCommand } from '../commands/command-contract';

export function createHeadlessGameplayAuthorities(
  composition?: WorldComposition,
  scriptPolicy?: WorldAuthorizationPolicy,
) {
  if (!composition) return {};
  return {
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, {
      playerAlias: 'headless-player',
      scriptAuthorization: scriptPolicy ? new WorldResourceAuthorizer(scriptPolicy, composition.resources) : undefined,
    }),
  };
}

export function headlessModuleCommandBinding(
  runtime: AuthorityRuntime,
  command: ServerCommand,
  developer: WorldModuleBinding,
  custom: boolean,
): WorldModuleBinding {
  if (custom || command.type !== 'attack-entity') return developer;
  const binding = createGameplayActorAuthority(runtime.server.gameplayResources, {
    playerAlias: 'headless-player',
  }).forActor(runtime.playerId, 'player');
  if (!binding) throw new Error('Headless player Combat authority is unavailable.');
  return binding;
}
