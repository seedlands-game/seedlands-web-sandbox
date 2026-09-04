import { Voxel } from '../../world/voxel';
import type {
  CommandParseFailure,
  CommandParseResult,
  CommandResult,
  CommandSource,
  ServerCommand,
} from './command-contract';
import type { ServerCommandExecutor } from './server-command-executor';

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

function parseTokens(tokens: string[]): ServerCommand {
  const name = tokens[0].toLowerCase();
  switch (name) {
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
  executor: ServerCommandExecutor,
  source: CommandSource,
  input: string,
): Promise<SlashCommandExecution> {
  const parsed = parseSlashCommand(input);
  if (!parsed.success) return { command: null, result: parsed };
  return { command: parsed.command, result: await executor.execute(source, parsed.command) };
}
