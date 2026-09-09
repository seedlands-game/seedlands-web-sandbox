import type { InputCommand } from '@seedlands/game-core/runtime/session-protocol';
import { PROTOCOL_VERSION } from '@seedlands/game-core/runtime/session-protocol';
import {
  ALL_COMMAND_CAPABILITIES,
  type CommandSource,
  type ServerCommand,
} from '@seedlands/game-core/server/commands/command-contract';
import type { AuthorityAction } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { AuthorityRequest, AuthorityResponse } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { VoxelEdit } from '@seedlands/game-core/server/world-mutation';
import {
  WorldResourceAuthorizer,
  commandAuthorizationRequests,
  playerActionAuthorizationRequests,
  playerInputAuthorizationRequest,
  worldEditAuthorizationRequests,
  type WorldAuthorizationRequest,
  type WorldResourceRegistration,
} from '@seedlands/game-core/server/harness/world-authorization';

type ActionOwner = (actionId: string) => string | null;
const isModeCommand = (command: ServerCommand) =>
  ['set-mode', 'set-flight', 'set-creative-slot'].includes(command.type);
type Post = (response: AuthorityResponse) => void;

export const rejectStaleAuthorityMessage = (message: AuthorityRequest, epoch: string, post: Post): void => {
  if (message.kind === 'input') {
    post({
      kind: 'input-decision',
      protocolVersion: PROTOCOL_VERSION,
      epoch,
      sequence: message.sequence,
      decision: 'wrong-epoch',
      requiresResync: true,
    });
  }
};

export class BrowserAuthorityIngress {
  private readonly authorization: WorldResourceAuthorizer;

  constructor(
    private readonly playerId: string,
    resources: readonly WorldResourceRegistration[] = [],
  ) {
    this.authorization = new WorldResourceAuthorizer(
      {
        principals: [
          { id: 'browser-player', kind: 'actor', subject: 'seedlands:local-player', boundEntityId: playerId },
          { id: 'browser-command', boundEntityId: playerId },
          { id: 'browser-logic' },
          { id: 'browser-fluid' },
        ],
        rules: [
          {
            effect: 'allow',
            principal: { ids: ['browser-player'] },
            resources: ['world.input', 'world.action', 'world.entity'],
            operations: ['execute', 'write'],
            scope: 'self',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-player'] },
            resources: ['world.interaction', 'world.voxel'],
            operations: ['execute', 'write'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-player'] },
            resources: ['seedlands.mode'],
            operations: ['read', 'write', 'execute'],
            scope: 'self',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-player'] },
            resources: ['seedlands.ruleset'],
            operations: ['read'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-player'] },
            resources: ['seedlands.combat'],
            operations: ['read', 'execute'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-command'] },
            resources: ['*'],
            operations: ['*'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-logic'] },
            resources: ['world.logic'],
            operations: ['execute'],
            scope: 'any',
          },
          {
            effect: 'allow',
            principal: { ids: ['browser-fluid'] },
            resources: ['world.fluid'],
            operations: ['execute', 'control'],
            scope: 'any',
          },
        ],
      },
      resources,
    );
  }

  commandBinding(command: ServerCommand) {
    return {
      authorizer: this.authorization,
      principalId: isModeCommand(command) || command.type === 'attack-entity' ? 'browser-player' : 'browser-command',
    };
  }

  input(command: InputCommand): void {
    this.authorize('browser-player', playerInputAuthorizationRequest(this.playerId, command));
  }

  worldEdit(actorId: string, edits: readonly VoxelEdit[]): void {
    this.authorize('browser-player', worldEditAuthorizationRequests(this.playerId, edits));
    if (actorId !== this.playerId)
      throw new Error('WORLD_PERMISSION_DENIED: World edit actor is not the bound player.');
  }

  position(): void {
    this.authorize('browser-player', {
      resource: 'world.entity',
      operation: 'write',
      target: { kind: 'entity', entityId: this.playerId },
    });
  }

  action(action: AuthorityAction): void {
    this.authorize('browser-player', playerActionAuthorizationRequests(this.playerId, action));
  }

  command(command: ServerCommand, actionOwner: ActionOwner): CommandSource {
    const source: CommandSource = {
      actorId: this.playerId,
      entityId: this.playerId,
      sourceType: 'local-developer',
      capabilities: ALL_COMMAND_CAPABILITIES,
    };
    this.authorize(
      this.commandBinding(command).principalId,
      commandAuthorizationRequests(source, command, actionOwner),
    );
    return source;
  }

  fluid(operation: 'control' | 'execute'): void {
    this.authorize('browser-fluid', { resource: 'world.fluid', operation, target: { kind: 'world' } });
  }

  logic(): void {
    this.authorize('browser-logic', { resource: 'world.logic', operation: 'execute', target: { kind: 'world' } });
  }

  private authorize(principalId: string, requests: WorldAuthorizationRequest | readonly WorldAuthorizationRequest[]) {
    for (const request of Array.isArray(requests) ? requests : [requests]) {
      const decision = this.authorization.authorize(principalId, request);
      if (!decision.allowed) throw new Error(`${decision.code}: ${decision.message}`);
    }
  }
}
