import type { InputCommand } from '@seedlands/stdlib/runtime/session-protocol';

export type NativeMovementInput = Readonly<{
  epoch: string;
  release: Readonly<{ code: string; sequence: number; neutral: boolean }> | null;
}>;
type Release = NonNullable<NativeMovementInput['release']> & Readonly<{ epoch: string }>;
const releases = new WeakMap<object, Release>();

/** One derived observation per Controller; it never submits or changes input. */
export function recordNativeRelease(owner: object, code: string, command: InputCommand | null): void {
  if (!command) return;
  releases.set(owner, {
    epoch: command.epoch,
    code,
    sequence: command.sequence,
    neutral:
      command.state.moveX === 0 &&
      command.state.moveZ === 0 &&
      command.state.verticalIntent === 0 &&
      !command.state.jumpHeld,
  });
}

export function readNativeInput(owner: object, epoch: string): NativeMovementInput {
  const release = releases.get(owner);
  return {
    epoch,
    release:
      release?.epoch === epoch ? { code: release.code, sequence: release.sequence, neutral: release.neutral } : null,
  };
}
