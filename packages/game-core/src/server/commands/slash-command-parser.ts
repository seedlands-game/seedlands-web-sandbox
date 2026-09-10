import { Voxel } from '../../world/voxel';
import { isItemId } from '../gameplay/item-registry';
import type {
  CommandParseFailure,
  CommandParseResult,
  CommandResult,
  CommandSource,
  ServerCommand,
} from './command-contract';
export type CommandExecutorPort = Readonly<{
  execute(source: CommandSource, command: ServerCommand): Promise<CommandResult>;
}>;

const voxelByName: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.entries(Voxel).map(([name, value]) => [name.toLowerCase(), value])),
);

class ParseProblem extends Error {}

const failure = (message: string): CommandParseFailure => ({
  success: false,
  error: { kind: 'parse', code: 'COMMAND_PARSE_FAILED', message },
});

function exact(tokens: readonly string[], count: number, usage: string): void {
  if (tokens.length !== count) throw new ParseProblem(`Usage: ${usage}`);
}

function integer(token: string, label: string): number {
  const value = Number(token);
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647)
    throw new ParseProblem(`${label} must be a signed 32-bit integer.`);
  return value;
}

function finite(token: string, label: string): number {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new ParseProblem(`${label} must be a finite number.`);
  return value;
}

function voxel(token: string): number {
  const value = voxelByName[token.toLowerCase()];
  if (value === undefined) throw new ParseProblem(`Unsupported voxel: ${token}.`);
  return value;
}

function item(token: string): string {
  const normalized = token.toLowerCase();
  if (!isItemId(normalized)) throw new ParseProblem(`Invalid item id: ${token}.`);
  return normalized;
}

function actorArchetype(token: string): 'grazer' | 'night-stalker' | 'settler' {
  if (!['grazer', 'night-stalker', 'settler'].includes(token))
    throw new ParseProblem(`Unsupported actor archetype: ${token}.`);
  return token as 'grazer' | 'night-stalker' | 'settler';
}

function parseTokens(tokens: string[]): ServerCommand {
  const name = tokens[0].toLowerCase();
  switch (name) {
    case '/gamemode':
      exact(tokens, 2, '/gamemode survival|creative');
      if (tokens[1] !== 'survival' && tokens[1] !== 'creative') throw new ParseProblem('Unknown actor mode.');
      return { type: 'set-mode', mode: tokens[1] };
    case '/fly':
      exact(tokens, 2, '/fly on|off');
      if (tokens[1] !== 'on' && tokens[1] !== 'off') throw new ParseProblem('Flight requires on or off.');
      return { type: 'set-flight', enabled: tokens[1] === 'on' };
    case '/creative-slot': {
      exact(tokens, 3, '/creative-slot <0..7> <item|empty>');
      const slot = integer(tokens[1], 'slot');
      if (slot < 0 || slot > 7) throw new ParseProblem('Creative slot must be 0..7.');
      return { type: 'set-creative-slot', slot, itemId: tokens[2] === 'empty' ? null : item(tokens[2]) };
    }
    case '/setblock':
      exact(tokens, 5, '/setblock <x> <y> <z> <voxel>');
      return {
        type: 'set-block',
        position: [integer(tokens[1], 'x'), integer(tokens[2], 'y'), integer(tokens[3], 'z')],
        voxel: voxel(tokens[4]),
      };
    case '/fill':
      exact(tokens, 8, '/fill <x1> <y1> <z1> <x2> <y2> <z2> <voxel>');
      return {
        type: 'fill',
        from: [integer(tokens[1], 'x1'), integer(tokens[2], 'y1'), integer(tokens[3], 'z1')],
        to: [integer(tokens[4], 'x2'), integer(tokens[5], 'y2'), integer(tokens[6], 'z2')],
        voxel: voxel(tokens[7]),
      };
    case '/tp':
      exact(tokens, 4, '/tp <x> <y> <z>');
      return {
        type: 'teleport',
        position: [finite(tokens[1], 'x'), finite(tokens[2], 'y'), finite(tokens[3], 'z')],
      };
    case '/time':
      if (tokens[1]?.toLowerCase() === 'get') {
        exact(tokens, 2, '/time get');
        return { type: 'time-get' };
      }
      if (tokens[1]?.toLowerCase() === 'set') {
        exact(tokens, 3, '/time set <hours>');
        return { type: 'time-set', hours: finite(tokens[2], 'hours') };
      }
      throw new ParseProblem('Usage: /time get | /time set <hours>');
    case '/seed':
      exact(tokens, 1, '/seed');
      return { type: 'seed' };
    case '/save':
      exact(tokens, 1, '/save');
      return { type: 'save' };
    case '/inventory':
      exact(tokens, 1, '/inventory');
      return { type: 'query-inventory' };
    case '/health':
    case '/hunger':
      exact(tokens, 1, `${name}`);
      return { type: 'query-player-state' };
    case '/give':
      exact(tokens, 3, '/give <item> <count>');
      return { type: 'give-item', itemId: item(tokens[1]), count: integer(tokens[2], 'count') };
    case '/damage':
      exact(tokens, 2, '/damage <amount>');
      return { type: 'apply-damage', amount: finite(tokens[1], 'amount') };
    case '/heal':
      exact(tokens, 2, '/heal <amount>');
      return { type: 'heal', amount: finite(tokens[1], 'amount') };
    case '/craft':
      exact(tokens, 2, '/craft <recipe>');
      return { type: 'craft-recipe', recipeId: tokens[1] };
    case '/spawnitem':
      exact(tokens, 6, '/spawnitem <item> <count> <x> <y> <z>');
      return {
        type: 'spawn-world-item',
        itemId: item(tokens[1]),
        count: integer(tokens[2], 'count'),
        position: [finite(tokens[3], 'x'), finite(tokens[4], 'y'), finite(tokens[5], 'z')],
      };
    case '/spawn':
      if (tokens[1]?.toLowerCase() !== 'creature') throw new ParseProblem('Usage: /spawn creature <x> <y> <z>');
      exact(tokens, 5, '/spawn creature <x> <y> <z>');
      return {
        type: 'spawn-creature',
        position: [finite(tokens[2], 'x'), finite(tokens[3], 'y'), finite(tokens[4], 'z')],
      };
    case '/summon':
      exact(tokens, 5, '/summon <grazer|night-stalker|settler> <x> <y> <z>');
      return {
        type: 'spawn-actor',
        archetype: actorArchetype(tokens[1].toLowerCase()),
        position: [finite(tokens[2], 'x'), finite(tokens[3], 'y'), finite(tokens[4], 'z')],
      };
    case '/observe':
      if (tokens.length > 2) throw new ParseProblem('Usage: /observe [entity-id]');
      return { type: 'query-observation', ...(tokens[1] ? { entityId: tokens[1] } : {}) };
    case '/entity':
      if (tokens[1]?.toLowerCase() === 'action') {
        exact(tokens, 3, '/entity action <entity-id>');
        return { type: 'query-action', entityId: tokens[2] };
      }
      if (tokens[1]?.toLowerCase() === 'move') {
        exact(tokens, 6, '/entity move <entity-id> <x> <y> <z>');
        return {
          type: 'start-action',
          entityId: tokens[2],
          action: 'move-to',
          position: [finite(tokens[3], 'x'), finite(tokens[4], 'y'), finite(tokens[5], 'z')],
        };
      }
      if (tokens[1]?.toLowerCase() === 'stop') {
        exact(tokens, 3, '/entity stop <entity-id>');
        return { type: 'interrupt-action', entityId: tokens[2] };
      }
      throw new ParseProblem(
        'Usage: /entity action <entity-id> | /entity move <entity-id> <x> <y> <z> | /entity stop <entity-id>',
      );
    case '/path':
      exact(tokens, 5, '/path <entity-id> <x> <y> <z>');
      return {
        type: 'query-path',
        entityId: tokens[1],
        position: [finite(tokens[2], 'x'), finite(tokens[3], 'y'), finite(tokens[4], 'z')],
      };
    case '/poi':
      if (tokens[1]?.toLowerCase() !== 'nearby') throw new ParseProblem('Usage: /poi nearby <entity-id> <radius>');
      exact(tokens, 4, '/poi nearby <entity-id> <radius>');
      return { type: 'query-pois', entityId: tokens[2], radius: finite(tokens[3], 'radius') };
    case '/break':
      exact(tokens, 4, '/break <x> <y> <z>');
      return {
        type: 'break-voxel',
        position: [integer(tokens[1], 'x'), integer(tokens[2], 'y'), integer(tokens[3], 'z')],
      };
    case '/cancelbreak':
      exact(tokens, 1, '/cancelbreak');
      return { type: 'cancel-break' };
    case '/pickup':
      exact(tokens, 2, '/pickup <entity-id>');
      return { type: 'pickup-item', entityId: tokens[1] };
    case '/drop':
      exact(tokens, 3, '/drop <slot> <count>');
      return { type: 'drop-item', slot: integer(tokens[1], 'slot'), count: integer(tokens[2], 'count') };
    case '/place':
      exact(tokens, 4, '/place <x> <y> <z>');
      return {
        type: 'place-voxel',
        position: [integer(tokens[1], 'x'), integer(tokens[2], 'y'), integer(tokens[3], 'z')],
      };
    case '/use':
      exact(tokens, 1, '/use');
      return { type: 'use-item' };
    case '/attack':
      exact(tokens, 2, '/attack <entity-id>');
      return { type: 'attack-entity', entityId: tokens[1] };
    case '/respawn':
      exact(tokens, 1, '/respawn');
      return { type: 'respawn' };
    case '/tick':
      exact(tokens, 2, '/tick <seconds>');
      return { type: 'advance-gameplay', seconds: finite(tokens[1], 'seconds') };
    case '/nearby':
      exact(tokens, 2, '/nearby <radius>');
      return { type: 'query-nearby', radius: finite(tokens[1], 'radius') };
    case '/inspect':
      if (tokens[1]?.toLowerCase() === 'voxel') {
        exact(tokens, 5, '/inspect voxel <x> <y> <z>');
        return {
          type: 'inspect-voxel',
          position: [integer(tokens[2], 'x'), integer(tokens[3], 'y'), integer(tokens[4], 'z')],
        };
      }
      if (tokens[1]?.toLowerCase() === 'chunk') {
        exact(tokens, 5, '/inspect chunk <cx> <cy> <cz>');
        return {
          type: 'inspect-chunk',
          chunk: [integer(tokens[2], 'cx'), integer(tokens[3], 'cy'), integer(tokens[4], 'cz')],
        };
      }
      throw new ParseProblem('Usage: /inspect voxel <x> <y> <z> | /inspect chunk <cx> <cy> <cz>');
    default:
      throw new ParseProblem(`Unknown command: ${tokens[0]}.`);
  }
}

export function parseSlashCommand(input: string): CommandParseResult {
  const tokens = input.trim().split(/\s+/);
  if (!input.trim()) return failure('Command must not be empty.');
  if (!tokens[0].startsWith('/')) return failure('Slash commands must start with /.');
  try {
    return { success: true, command: parseTokens(tokens) };
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export type SlashCommandExecution = {
  command: ServerCommand | null;
  result: CommandResult | CommandParseFailure;
};

export async function executeSlashCommand(
  executor: CommandExecutorPort,
  source: CommandSource,
  input: string,
): Promise<SlashCommandExecution> {
  const parsed = parseSlashCommand(input);
  if (!parsed.success) return { command: null, result: parsed };
  return { command: parsed.command, result: await executor.execute(source, parsed.command) };
}
