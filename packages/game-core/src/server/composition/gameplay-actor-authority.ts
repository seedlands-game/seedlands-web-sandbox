import { validateDurableExecutionOrigin, type DurableExecutionOriginV1 } from './execution-origin';
import type { EntityType } from '../gameplay/entity-store';
import type { WorldModuleBinding } from '../commands/module-command';
import { WorldResourceAuthorizer, type WorldResourceRegistration } from '../harness/world-authorization';

const PLAYER_SUBJECT = 'seedlands:local-player';
const AUTONOMY_SUBJECT = 'seedlands:autonomy';
export type ModuleActorAuthority = Readonly<{
  forActor(actorId: string, kind: EntityType): WorldModuleBinding | undefined;
  resolveOrigin(origin: DurableExecutionOriginV1, kind: EntityType): WorldModuleBinding | undefined;
}>;

/** Explicit product policy; neither module declarations nor restored data add grants. */
export function createGameplayActorAuthority(
  resources: readonly WorldResourceRegistration[],
  options: Readonly<{ playerAlias: string; scriptAuthorization?: WorldResourceAuthorizer }>,
): ModuleActorAuthority {
  if (
    options.scriptAuthorization?.principalForSubject(PLAYER_SUBJECT) ||
    options.scriptAuthorization?.principalForSubject(AUTONOMY_SUBJECT)
  )
    throw new TypeError('Script policy cannot claim a reserved gameplay subject.');
  const forActor = (actorId: string, kind: EntityType): WorldModuleBinding | undefined => {
    if (kind !== 'player' && kind !== 'npc' && kind !== 'creature') return undefined;
    if (!actorId || actorId.trim() !== actorId || actorId.length > 256)
      throw new TypeError('Gameplay actor identity is invalid.');
    const principalId = kind === 'player' ? options.playerAlias : 'gameplay-autonomy';
    const authorizer = new WorldResourceAuthorizer(
      {
        principals: [
          {
            id: principalId,
            kind: 'actor',
            subject: kind === 'player' ? PLAYER_SUBJECT : AUTONOMY_SUBJECT,
            ...(kind === 'player' ? { boundEntityId: actorId } : {}),
          },
        ],
        rules: [
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: ['seedlands.combat'],
            operations: ['read', 'write', 'execute'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: ['seedlands.inventory', 'seedlands.mode', 'seedlands.block-actor'],
            operations: ['read', 'write', 'execute'],
            scope: kind === 'player' ? 'self' : 'any',
          },
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: ['seedlands.inventory-item', 'seedlands.block-voxel'],
            operations: ['read', 'execute'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: [principalId] },
            resources: ['seedlands.ruleset'],
            operations: ['read'],
            scope: 'any',
          },
        ],
      },
      resources,
    );
    return Object.freeze({ principalId, authorizer });
  };
  return Object.freeze({
    forActor,
    resolveOrigin(raw, kind) {
      const origin = validateDurableExecutionOrigin(raw);
      if (kind !== 'player' && kind !== 'npc' && kind !== 'creature') return undefined;
      const expected = kind === 'player' ? PLAYER_SUBJECT : AUTONOMY_SUBJECT;
      if (origin.principalSubject === expected) return forActor(origin.originalActor.entityId, kind);
      const authorizer = options.scriptAuthorization;
      const principal = authorizer?.principalForSubject(origin.principalSubject);
      if (
        !authorizer ||
        !principal ||
        principal.kind === 'system' ||
        (principal.boundEntityId !== undefined && principal.boundEntityId !== origin.originalActor.entityId)
      )
        return undefined;
      return Object.freeze({ authorizer, principalId: principal.id });
    },
  });
}
