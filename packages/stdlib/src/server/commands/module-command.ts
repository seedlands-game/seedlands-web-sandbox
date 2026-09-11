import type { GameServer } from '../game-server';
import type { WorldResourceAuthorizer } from '../harness/world-authorization';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../composition/operation-contracts';
import type { CommandSource } from './command-contract';

export type ModeCommand =
  | { type: 'set-mode'; mode: 'survival' | 'creative' }
  | { type: 'set-flight'; enabled: boolean }
  | { type: 'set-creative-slot'; slot: number; itemId: string | null };
export type ModuleCommandPort = (actorId: string, request: RegisteredOperationRequest) => RegisteredOperationResult;

export function executeModeCommand(source: CommandSource, command: ModeCommand, invoke?: ModuleCommandPort) {
  if (!invoke || !source.entityId) throw new Error('Mode command requires a host-authorized module binding.');
  const target = { kind: 'entity' as const, entityId: source.entityId };
  const request: RegisteredOperationRequest =
    command.type === 'set-mode'
      ? { operationId: 'seedlands:set-mode', target, input: { mode: command.mode } }
      : command.type === 'set-flight'
        ? { operationId: 'seedlands:set-flight', target, input: { enabled: command.enabled } }
        : {
            operationId: 'seedlands:set-creative-catalog',
            target,
            input: { slot: command.slot, itemId: command.itemId },
          };
  const result = invoke(source.entityId, request);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return { message: 'Updated actor mode controls.', data: result.value };
}

export type WorldModuleBinding = Readonly<{ authorizer: WorldResourceAuthorizer; principalId: string }>;
export function bindModuleCommandPort(server: GameServer, binding?: WorldModuleBinding): ModuleCommandPort | undefined {
  return binding
    ? (actorId, request) =>
        server.invokeModuleOperation(
          binding.authorizer,
          { principalId: binding.principalId, originalActorId: actorId },
          request,
        )
    : undefined;
}
