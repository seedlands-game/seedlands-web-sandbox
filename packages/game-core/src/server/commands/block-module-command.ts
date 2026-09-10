import type { GameServer } from '../game-server';
import type { CommandSource, ServerCommand } from './command-contract';
import type { ModuleCommandPort } from './module-command';
import type { RegisteredOperationRequest } from '../composition/operation-contracts';

/** Ordinary block commands retain the actual host-bound actor and return real world receipts. */
export function executeBlockModuleCommand(
  server: GameServer,
  source: CommandSource,
  command: ServerCommand,
  invoke?: ModuleCommandPort,
) {
  if (!server.hasGameplayComposition || !['break-voxel', 'cancel-break', 'place-voxel'].includes(command.type))
    return null;
  const id = source.entityId;
  if (!id || !invoke) throw new Error('Block command requires a host-authorized actor binding.');
  let request: RegisteredOperationRequest;
  if (command.type === 'cancel-break') {
    request = { operationId: 'seedlands:block-cancel', target: { kind: 'entity', entityId: id } };
  } else if (command.type === 'break-voxel' || command.type === 'place-voxel') {
    request = {
      operationId: command.type === 'break-voxel' ? 'seedlands:block-begin' : 'seedlands:block-place',
      target: { kind: 'voxel', position: command.position },
      input: { position: command.position },
    };
  } else return null;
  const result = invoke(id, request);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  const commit = server.acknowledgeBlockCommit(result.value);
  if (command.type === 'place-voxel' && !commit) throw new Error('Block placement did not produce a world receipt.');
  return {
    message:
      command.type === 'place-voxel'
        ? 'Placed voxel.'
        : command.type === 'break-voxel'
          ? 'Started breaking voxel.'
          : 'Cancelled breaking voxel.',
    data: result.value,
    ...(commit ? { commit, affectedChunks: commit.structuralChange?.chunks ?? [] } : {}),
  };
}
