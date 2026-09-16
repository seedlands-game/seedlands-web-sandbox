export type ReservedCommandOptions = {
  command: string;
  args?: string[];
  lockDirectory?: string;
  waitTimeoutMs?: number;
  pollMs?: number;
  ownerThread?: string;
  evidencePath?: string;
  rootDirectory?: string;
};

export type ReservedCommandResult = {
  exitCode: number;
  windowId: string;
  evidencePath: string;
};

export const defaultLockDirectory: string;
export function runReservedCommand(options: ReservedCommandOptions): Promise<ReservedCommandResult>;
export function main(argv?: string[]): Promise<number>;
