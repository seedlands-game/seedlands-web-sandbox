import { validateDurableExecutionOrigin } from '../composition/execution-origin';
import type { BreakAction } from './player-state';

export const copyBreakAction = (value: BreakAction | null | undefined): BreakAction | null => {
  if (value === null || value === undefined) return null;
  if (
    value.position.length !== 3 ||
    !value.position.every(Number.isFinite) ||
    !Number.isInteger(value.voxel) ||
    value.voxel < 0 ||
    !Number.isFinite(value.elapsedSeconds) ||
    value.elapsedSeconds < 0 ||
    !Number.isFinite(value.requiredSeconds) ||
    value.requiredSeconds < 0
  )
    throw new TypeError('Invalid player break action component.');
  return {
    ...value,
    position: [...value.position],
    ...(value.origin === undefined ? {} : { origin: validateDurableExecutionOrigin(value.origin) }),
  };
};
