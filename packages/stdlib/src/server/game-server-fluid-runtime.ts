import type { ServerChunk, WorldCommitResult } from './game-server-types';
import type { FluidActiveWindow } from './fluid/fluid-active-window';
import type { FluidChunkAccess } from './fluid/fluid-chunk-access';
import * as FluidSidecars from './fluid/fluid-edit-sidecars';
import { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { ServerWorldCommitHost } from './server-world-commit-host';

type Options = Readonly<{
  chunks: ReadonlyMap<string, ServerChunk>;
  fluidWindow: FluidActiveWindow;
  fluidChunks: FluidChunkAccess;
  worldCommits(): ServerWorldCommitHost;
}>;

export function createGameServerFluidRuntime(
  epoch: number,
  options: Options,
): FluidTransactionRuntime<WorldCommitResult> {
  return new FluidTransactionRuntime({
    epoch,
    readChunk: (key) =>
      FluidSidecars.readFluidChunk(key, (candidate) => options.fluidWindow.allowsKey(candidate), options.chunks),
    readCell: (position) =>
      FluidSidecars.readFluidCell(position, (x, y, z) => options.fluidWindow.allowsPosition(x, y, z), options.chunks),
    apply: (candidate) => options.worldCommits().applyFluidCandidate(candidate),
  });
}

export function createNextGameServerFluidRuntime(
  current: FluidTransactionRuntime<WorldCommitResult>,
  options: Options,
): FluidTransactionRuntime<WorldCommitResult> {
  const epoch = current.authority.epoch;
  if (!Number.isSafeInteger(epoch) || epoch >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Fluid transaction epoch is exhausted or invalid.');
  return createGameServerFluidRuntime(epoch + 1, options);
}
