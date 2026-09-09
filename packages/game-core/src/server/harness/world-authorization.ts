import type { CommandSource, ServerCommand } from '../commands/command-contract';
import type { AuthorityAction } from '../../compute/authority-worker-protocol';
import type { InputCommand } from '../../runtime/session-protocol';
import type { VoxelEdit } from '../world-mutation';

export const BUILTIN_WORLD_RESOURCES = Object.freeze([
  'world.identity',
  'world.voxel',
  'world.chunk',
  'world.entity',
  'world.actor',
  'world.prepare',
  'world.command',
  'world.clock',
  'world.logic',
  'world.action',
  'world.interaction',
  'world.input',
  'world.fluid',
  'world.barrier',
  'world.trace',
  'world.checkpoint',
] as const);

export type BuiltinWorldResource = (typeof BUILTIN_WORLD_RESOURCES)[number];
/** Module resources remain strings at the request boundary and must be present in the authorizer catalog. */
export type WorldResource = string;

export type WorldOperation = 'read' | 'execute' | 'write' | 'control' | 'export' | 'restore';

export type WorldAuthorizationTarget =
  | Readonly<{ kind: 'world' }>
  | Readonly<{ kind: 'entity'; entityId: string }>
  | Readonly<{ kind: 'chunk'; chunk: readonly [number, number, number] }>
  | Readonly<{ kind: 'voxel'; position: readonly [number, number, number] }>;

export type WorldAuthorizationRequest = Readonly<{
  resource: WorldResource;
  operation: WorldOperation;
  target: WorldAuthorizationTarget;
}>;

export type WorldResourceRegistration = Readonly<{
  id: WorldResource;
  operations: readonly WorldOperation[];
}>;

export type WorldPrincipal = Readonly<{
  id: string;
  labels?: readonly string[];
  boundEntityId?: string;
}>;

export type WorldAuthorizationRule = Readonly<{
  effect: 'allow' | 'deny';
  principal?: Readonly<{ ids?: readonly (string | '*')[]; labels?: readonly string[] }>;
  resources: readonly (WorldResource | '*')[];
  operations: readonly (WorldOperation | '*')[];
  scope?: 'any' | 'self';
}>;

export type WorldAuthorizationPolicy = Readonly<{
  principals: readonly WorldPrincipal[];
  rules: readonly WorldAuthorizationRule[];
}>;

export type WorldAuthorizationDecision = Readonly<
  | { allowed: true; principal: WorldPrincipal }
  | {
      allowed: false;
      code:
        | 'WORLD_RESOURCE_UNKNOWN'
        | 'WORLD_OPERATION_UNREGISTERED'
        | 'WORLD_PRINCIPAL_UNKNOWN'
        | 'WORLD_PERMISSION_DENIED';
      message: string;
    }
>;

const ALL_WORLD_OPERATIONS: readonly WorldOperation[] = Object.freeze([
  'read',
  'execute',
  'write',
  'control',
  'export',
  'restore',
]);

const targetWithinSelf = (principal: WorldPrincipal, target: WorldAuthorizationTarget): boolean =>
  target.kind === 'entity' && Boolean(principal.boundEntityId) && target.entityId === principal.boundEntityId;

const selectorMatches = (principal: WorldPrincipal, rule: WorldAuthorizationRule): boolean => {
  const ids = rule.principal?.ids;
  if (ids && !ids.includes('*') && !ids.includes(principal.id)) return false;
  const labels = rule.principal?.labels;
  if (labels && !labels.every((label) => principal.labels?.includes(label))) return false;
  return true;
};

const ruleMatches = (
  principal: WorldPrincipal,
  rule: WorldAuthorizationRule,
  request: WorldAuthorizationRequest,
): boolean =>
  selectorMatches(principal, rule) &&
  (rule.resources.includes('*') || rule.resources.includes(request.resource)) &&
  (rule.operations.includes('*') || rule.operations.includes(request.operation)) &&
  (rule.scope !== 'self' || targetWithinSelf(principal, request.target));

/**
 * 宿主在构造时绑定 principal；授权请求本身没有 role/label 字段，不能自授角色。
 * deny 优先于 allow，且没有匹配规则时默认拒绝。
 */
export class WorldResourceAuthorizer {
  private readonly principals: ReadonlyMap<string, WorldPrincipal>;
  private readonly resources: ReadonlyMap<WorldResource, ReadonlySet<WorldOperation>>;
  private readonly rules: readonly WorldAuthorizationRule[];

  constructor(policy: WorldAuthorizationPolicy, moduleResources: readonly WorldResourceRegistration[] = []) {
    const principals = new Map<string, WorldPrincipal>();
    for (const principal of policy.principals) {
      if (!principal.id.trim()) throw new TypeError('World principal id must not be empty.');
      if (principals.has(principal.id)) throw new TypeError(`Duplicate world principal: ${principal.id}`);
      principals.set(
        principal.id,
        Object.freeze({ ...principal, labels: Object.freeze([...(principal.labels ?? [])]) }),
      );
    }
    this.principals = principals;
    this.rules = Object.freeze(
      policy.rules.map((rule) =>
        Object.freeze({
          effect: rule.effect,
          ...(rule.principal
            ? {
                principal: Object.freeze({
                  ...(rule.principal.ids ? { ids: Object.freeze([...rule.principal.ids]) } : {}),
                  ...(rule.principal.labels ? { labels: Object.freeze([...rule.principal.labels]) } : {}),
                }),
              }
            : {}),
          resources: Object.freeze([...rule.resources]),
          operations: Object.freeze([...rule.operations]),
          ...(rule.scope ? { scope: rule.scope } : {}),
        }),
      ),
    );
    const resources = new Map<WorldResource, ReadonlySet<WorldOperation>>(
      BUILTIN_WORLD_RESOURCES.map((id) => [id, new Set(ALL_WORLD_OPERATIONS)]),
    );
    for (const resource of moduleResources) {
      if (!resource.id.trim()) throw new TypeError('World resource id must not be empty.');
      if (resources.has(resource.id)) throw new TypeError(`Duplicate world resource: ${resource.id}`);
      if (resource.operations.length === 0)
        throw new TypeError(`World resource operations must not be empty: ${resource.id}`);
      const operations = new Set<WorldOperation>();
      for (const operation of resource.operations) {
        if (!ALL_WORLD_OPERATIONS.includes(operation))
          throw new TypeError(`Invalid world resource operation: ${resource.id}/${operation}`);
        if (operations.has(operation))
          throw new TypeError(`Duplicate world resource operation: ${resource.id}/${operation}`);
        operations.add(operation);
      }
      resources.set(resource.id, operations);
    }
    this.resources = resources;
  }

  principal(id: string): WorldPrincipal | null {
    return this.principals.get(id) ?? null;
  }

  authorize(principalId: string, request: WorldAuthorizationRequest): WorldAuthorizationDecision {
    const operations = this.resources.get(request.resource);
    if (!operations)
      return {
        allowed: false,
        code: 'WORLD_RESOURCE_UNKNOWN',
        message: `Unknown world resource: ${request.resource || '<empty>'}.`,
      };
    if (!operations.has(request.operation))
      return {
        allowed: false,
        code: 'WORLD_OPERATION_UNREGISTERED',
        message: `World resource operation is not registered: ${request.resource}/${request.operation}.`,
      };
    const principal = this.principals.get(principalId);
    if (!principal)
      return {
        allowed: false,
        code: 'WORLD_PRINCIPAL_UNKNOWN',
        message: `Unknown world principal: ${principalId || '<empty>'}.`,
      };
    const matching = this.rules.filter((rule) => ruleMatches(principal, rule, request));
    if (matching.some((rule) => rule.effect === 'deny'))
      return { allowed: false, code: 'WORLD_PERMISSION_DENIED', message: 'World resource access was denied.' };
    if (matching.some((rule) => rule.effect === 'allow')) return { allowed: true, principal };
    return { allowed: false, code: 'WORLD_PERMISSION_DENIED', message: 'World resource access was denied.' };
  }
}

type CommandResourceDescriptor = Readonly<{
  resource: WorldResource;
  operation: WorldOperation;
  target: (command: ServerCommand, source: CommandSource) => WorldAuthorizationTarget;
}>;

const world = () => ({ kind: 'world' }) as const;
const ownEntity = (_command: ServerCommand, source: CommandSource) =>
  ({ kind: 'entity', entityId: source.entityId ?? source.actorId }) as const;
const explicitOrOwnEntity = (command: ServerCommand, source: CommandSource) =>
  ({
    kind: 'entity',
    entityId:
      'entityId' in command && typeof command.entityId === 'string'
        ? command.entityId
        : (source.entityId ?? source.actorId),
  }) as const;

export const COMMAND_RESOURCE_DIRECTORY = {
  'set-block': {
    resource: 'world.voxel',
    operation: 'write',
    target: (command) => ({
      kind: 'voxel',
      position: (command as Extract<ServerCommand, { type: 'set-block' }>).position,
    }),
  },
  fill: { resource: 'world.voxel', operation: 'write', target: world },
  teleport: { resource: 'world.entity', operation: 'write', target: explicitOrOwnEntity },
  'time-get': { resource: 'world.clock', operation: 'read', target: world },
  'time-set': { resource: 'world.clock', operation: 'control', target: world },
  seed: { resource: 'world.identity', operation: 'read', target: world },
  save: { resource: 'world.checkpoint', operation: 'export', target: world },
  'inspect-voxel': {
    resource: 'world.voxel',
    operation: 'read',
    target: (command) => ({
      kind: 'voxel',
      position: (command as Extract<ServerCommand, { type: 'inspect-voxel' }>).position,
    }),
  },
  'inspect-chunk': {
    resource: 'world.chunk',
    operation: 'read',
    target: (command) => ({
      kind: 'chunk',
      chunk: (command as Extract<ServerCommand, { type: 'inspect-chunk' }>).chunk,
    }),
  },
  'query-player-state': { resource: 'world.entity', operation: 'read', target: explicitOrOwnEntity },
  'query-inventory': { resource: 'world.entity', operation: 'read', target: explicitOrOwnEntity },
  'query-entity': { resource: 'world.entity', operation: 'read', target: explicitOrOwnEntity },
  'query-nearby': { resource: 'world.entity', operation: 'read', target: world },
  'query-item-definitions': { resource: 'world.identity', operation: 'read', target: world },
  'query-voxel-definitions': { resource: 'world.identity', operation: 'read', target: world },
  'query-recipes': { resource: 'world.identity', operation: 'read', target: world },
  'query-observation': { resource: 'world.actor', operation: 'read', target: world },
  'query-pois': { resource: 'world.actor', operation: 'read', target: world },
  'query-action': { resource: 'world.action', operation: 'read', target: explicitOrOwnEntity },
  'query-path': { resource: 'world.actor', operation: 'read', target: world },
  'select-slot': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'break-voxel': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'cancel-break': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'place-voxel': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'pickup-item': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'drop-item': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'use-item': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'craft-recipe': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'attack-entity': { resource: 'world.action', operation: 'execute', target: ownEntity },
  'start-action': { resource: 'world.action', operation: 'execute', target: explicitOrOwnEntity },
  'interrupt-action': { resource: 'world.action', operation: 'execute', target: explicitOrOwnEntity },
  respawn: { resource: 'world.action', operation: 'execute', target: ownEntity },
  'give-item': { resource: 'world.entity', operation: 'write', target: explicitOrOwnEntity },
  'remove-item': { resource: 'world.entity', operation: 'write', target: explicitOrOwnEntity },
  'spawn-world-item': { resource: 'world.entity', operation: 'write', target: world },
  'spawn-creature': { resource: 'world.entity', operation: 'write', target: world },
  'spawn-actor': { resource: 'world.entity', operation: 'write', target: world },
  'register-poi': { resource: 'world.actor', operation: 'write', target: world },
  'remove-poi': { resource: 'world.actor', operation: 'write', target: world },
  'despawn-entity': { resource: 'world.entity', operation: 'write', target: explicitOrOwnEntity },
  'apply-damage': { resource: 'world.entity', operation: 'write', target: explicitOrOwnEntity },
  heal: { resource: 'world.entity', operation: 'write', target: explicitOrOwnEntity },
  'advance-gameplay': { resource: 'world.clock', operation: 'control', target: world },
} satisfies Record<ServerCommand['type'], CommandResourceDescriptor>;

export function commandAuthorizationRequest(source: CommandSource, command: ServerCommand): WorldAuthorizationRequest {
  const descriptor = COMMAND_RESOURCE_DIRECTORY[command.type] as CommandResourceDescriptor;
  return {
    resource: descriptor.resource,
    operation: descriptor.operation,
    target: descriptor.target(command, source),
  };
}

export function commandAuthorizationRequests(
  source: CommandSource,
  command: ServerCommand,
  actionOwner?: (actionId: string) => string | null,
): readonly WorldAuthorizationRequest[] {
  const base = commandAuthorizationRequest(source, command);
  const requests: WorldAuthorizationRequest[] = [
    command.type === 'query-action' && command.actionId && actionOwner
      ? (() => {
          const owner = actionOwner(command.actionId);
          return { ...base, target: owner ? { kind: 'entity' as const, entityId: owner } : { kind: 'world' as const } };
        })()
      : base,
  ];
  switch (command.type) {
    case 'break-voxel':
    case 'place-voxel':
      requests.push({
        resource: 'world.interaction',
        operation: 'execute',
        target: { kind: 'voxel', position: command.position },
      });
      break;
    case 'pickup-item':
    case 'attack-entity':
      requests.push({
        resource: 'world.interaction',
        operation: 'execute',
        target: { kind: 'entity', entityId: command.entityId },
      });
      break;
    case 'start-action':
      if (command.targetEntityId)
        requests.push({
          resource: 'world.interaction',
          operation: 'execute',
          target: { kind: 'entity', entityId: command.targetEntityId },
        });
      if (command.position)
        requests.push({
          resource: 'world.interaction',
          operation: 'execute',
          target: { kind: 'voxel', position: command.position },
        });
      break;
  }
  return requests;
}

export const playerInputAuthorizationRequest = (playerId: string, _input: InputCommand): WorldAuthorizationRequest => ({
  resource: 'world.input',
  operation: 'execute',
  target: { kind: 'entity', entityId: playerId },
});

export const worldEditAuthorizationRequests = (
  actorId: string,
  edits: readonly VoxelEdit[],
): readonly WorldAuthorizationRequest[] => [
  { resource: 'world.entity', operation: 'write', target: { kind: 'entity', entityId: actorId } },
  ...edits.map((edit): WorldAuthorizationRequest => ({
    resource: 'world.voxel',
    operation: 'write',
    target: { kind: 'voxel', position: [edit.x, edit.y, edit.z] },
  })),
];

export const playerActionAuthorizationRequests = (
  playerId: string,
  action: AuthorityAction,
): readonly WorldAuthorizationRequest[] => {
  const requests: WorldAuthorizationRequest[] = [
    { resource: 'world.action', operation: 'execute', target: { kind: 'entity', entityId: playerId } },
  ];
  if (action.type === 'attack')
    requests.push({
      resource: 'world.interaction',
      operation: 'execute',
      target: { kind: 'entity', entityId: action.targetId },
    });
  if (action.type === 'begin-break' || action.type === 'place')
    requests.push({
      resource: 'world.interaction',
      operation: 'execute',
      target: { kind: 'voxel', position: action.position },
    });
  return requests;
};

export function developmentWorldAuthorizationPolicy(
  principalId: string,
  boundEntityId?: string,
): WorldAuthorizationPolicy {
  return {
    principals: [{ id: principalId, labels: ['trusted-developer'], ...(boundEntityId ? { boundEntityId } : {}) }],
    rules: [
      {
        effect: 'allow',
        principal: { ids: [principalId] },
        resources: ['*'],
        operations: ['*'],
        scope: 'any',
      },
    ],
  };
}
