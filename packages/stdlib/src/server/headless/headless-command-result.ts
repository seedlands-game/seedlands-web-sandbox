import type { AuthorityRuntime, AuthorityTransactionReceipt } from '../authority/authority-runtime';
import {
  commandCategory,
  type CommandFailure,
  type CommandResult,
  type CommandSource,
  type ServerCommand,
} from '../commands/command-contract';

export const transactionFailure = (
  runtime: AuthorityRuntime,
  source: CommandSource,
  command: ServerCommand,
  receipt: Exclude<AuthorityTransactionReceipt<CommandResult>, { status: 'executed' }>,
): CommandFailure => ({
  success: false,
  message: `Headless transaction was ${receipt.status}.`,
  error: {
    kind: 'execution',
    code: `HEADLESS_TRANSACTION_${receipt.status.toUpperCase()}`,
    message: `Headless transaction was ${receipt.status}.`,
  },
  affectedChunks: [],
  worldRevision: runtime.server.worldRevision,
  observation: {
    commandType: command.type,
    category: commandCategory(command) ?? 'administrative',
    actorId: source.actorId,
    sourceType: source.sourceType,
    durationMs: 0,
    success: false,
    errorKind: 'execution',
    affectedChunks: [],
    worldRevision: runtime.server.worldRevision,
    mutationCount: runtime.server.mutationCount,
    structuralEventCount: 0,
  },
});
