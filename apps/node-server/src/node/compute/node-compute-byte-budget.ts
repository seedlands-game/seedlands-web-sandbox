import { measureDedicatedComputeBytes } from '@seedlands/game-core/server/compute/dedicated-compute-bytes';
import { nodeCorePlatform } from '../runtime/node-core-platform';

export const measureNodeComputeBytes = (value: unknown, seen?: Set<object>) =>
  measureDedicatedComputeBytes(value, nodeCorePlatform.utf8, seen);
