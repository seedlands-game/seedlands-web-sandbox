import type { BodyConfig } from '../../physics';
import type {
  AuthorityActorModeState,
  AuthorityMovementSnapshot,
  AuthorityBodySnapshot,
  AuthorityServerPort,
  AuthorityEntity,
} from './authority-session-types';
import type { InputCommand } from '../../runtime/session-protocol';

export function projectActorMovement(
  mode: AuthorityActorModeState | null | undefined,
  verticalSpeed: number,
): AuthorityMovementSnapshot | undefined {
  return mode
    ? Object.freeze({
        revision: `${mode.mode}:${mode.modeRevision ?? 0}:${mode.flight.enabled}:${mode.flight.revision ?? 0}`,
        flightSpeed: mode.mode === 'creative' && mode.flight.enabled ? verticalSpeed : null,
      })
    : undefined;
}

export function movementInputCurrent(command: InputCommand, mode: AuthorityActorModeState | null | undefined): boolean {
  if (command.movementRevision === undefined)
    return !mode || ((mode.modeRevision ?? 0) === 0 && (mode.flight.revision ?? 0) === 0);
  return command.movementRevision === projectActorMovement(mode, 0)?.revision;
}

export function projectMovementBodies(
  options: Readonly<{
    playerId: string;
    server: AuthorityServerPort;
    bodyConfigFor(entity: AuthorityEntity): BodyConfig;
  }>,
  bodies: ReadonlyMap<string, AuthorityBodySnapshot>,
) {
  const player = bodies.get(options.playerId);
  const entity = options.server.getEntity(options.playerId);
  if (!player || !entity) throw new Error(`Authority player is missing: ${options.playerId}`);
  const movement = projectActorMovement(
    options.server.getActorModeState?.(player.id),
    options.bodyConfigFor(entity).maxHorizontalSpeed ?? 4.5,
  );
  const projected = movement ? { ...player, movement } : player;
  return {
    player: projected,
    entities: [...bodies.values()].map((body) => (body.id === player.id ? projected : body)),
  };
}

export function createMovementInputGuard(getMode: () => AuthorityActorModeState | null | undefined, clear: () => void) {
  let revision: string | undefined;
  const synchronize = () => {
    const mode = getMode();
    const next = projectActorMovement(mode, 0)?.revision;
    if (revision !== undefined && revision !== next) clear();
    revision = next;
    return mode;
  };
  return { synchronize, accept: (command: InputCommand) => movementInputCurrent(command, synchronize()) };
}
