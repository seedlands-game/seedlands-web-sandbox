import type { Page } from '@playwright/test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendNativeMovementPulse } from './native-movement-pulse';
import { updatePlayerMovementKeys } from '../../../src/app/player/player-movement-input';
import { readNativeInput, recordNativeRelease } from '../../../src/app/player/native-movement-input';
import { routePulseSettledPredicate } from './route-progress';

type Command = { phase: 'down' | 'up'; key: string; at: number };

function nativePage(options: { downDelay?: number; downFailure?: string; upFailure?: string } = {}) {
  const commands: Command[] = [];
  const failure = new Error('Native command failed');
  const keyboard = {
    down: async (key: string) => {
      commands.push({ phase: 'down', key, at: Date.now() });
      await new Promise<void>((resolve) => setTimeout(resolve, options.downDelay ?? 0));
      if (key === options.downFailure) throw failure;
    },
    up: async (key: string) => {
      commands.push({ phase: 'up', key, at: Date.now() });
      if (key === options.upFailure) throw failure;
    },
    // Installed Playwright 1.62.1 sequential chord semantics, not a DOM fixture.
    press: async (chord: string, options?: { delay?: number }) => {
      const keys = chord.split('+');
      for (const key of keys) await keyboard.down(key);
      await new Promise<void>((resolve) => setTimeout(resolve, options?.delay ?? 0));
      for (const key of keys.reverse()) await keyboard.up(key);
    },
  };
  return { page: { keyboard } as unknown as Pick<Page, 'keyboard'>, commands, failure };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

it('requests both releases at the pulse deadline while both down acknowledgements are pending', async () => {
  const { page, commands } = nativePage({ downDelay: 1000 });
  const pulse = sendNativeMovementPulse(page, 'KeyW', 300, true);
  try {
    await vi.advanceTimersByTimeAsync(300);
    expect(commands.filter((command) => command.phase === 'up')).toEqual([
      { phase: 'up', key: 'KeyW', at: 300 },
      { phase: 'up', key: 'Space', at: 300 },
    ]);
  } finally {
    await vi.runAllTimersAsync();
    await pulse;
  }
});

it('releases every participating key and preserves a failed down command', async () => {
  const { page, commands, failure } = nativePage({ downFailure: 'Space' });
  const result = sendNativeMovementPulse(page, 'KeyW', 300, true).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  expect(await result).toBe(failure);
  expect(
    commands
      .filter((command) => command.phase === 'up')
      .map((command) => command.key)
      .sort(),
  ).toEqual(['KeyW', 'Space']);
});

it('still releases direction when the jump release fails', async () => {
  const { page, commands, failure } = nativePage({ upFailure: 'Space' });
  const result = sendNativeMovementPulse(page, 'KeyW', 300, true).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  expect(await result).toBe(failure);
  expect(
    commands
      .filter((command) => command.phase === 'up')
      .map((command) => command.key)
      .sort(),
  ).toEqual(['KeyW', 'Space']);
});

it('requests a single direction release on time but awaits the late acknowledgement before returning', async () => {
  const { page, commands } = nativePage({ downDelay: 1000 });
  let returned = false;
  const pulse = sendNativeMovementPulse(page, 'KeyS', 300).then(() => {
    returned = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(300);
    expect(commands.filter((command) => command.phase === 'up')).toEqual([{ phase: 'up', key: 'KeyS', at: 300 }]);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(700);
    expect(returned).toBe(true);
  } finally {
    await vi.runAllTimersAsync();
    await pulse;
  }
});

it('stops direction before a queued jump release but waits for the final neutral ACK', async () => {
  const keys = new Set<string>();
  const owner = {};
  const epoch = 'native-release-priority';
  let sequence = 0;
  let queue = Promise.resolve();
  let returned = false;
  const page = {
    keyboard: {
      down: async (code: string) => {
        updatePlayerMovementKeys(keys, code, true);
      },
      up: (code: string) => {
        queue = queue.then(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 600));
          updatePlayerMovementKeys(keys, code, false);
          recordNativeRelease(owner, code, {
            kind: 'input',
            protocolVersion: 1,
            epoch,
            stream: 'player',
            sequence: ++sequence,
            targetPhysicsTick: sequence,
            issuedAtMs: Date.now(),
            state: {
              moveX: keys.has('KeyW') ? 1 : 0,
              moveZ: 0,
              verticalIntent: 0,
              jumpHeld: keys.has('Space'),
            },
            edges: { jumpPressed: false },
          });
        });
        return queue;
      },
    },
  } as unknown as Pick<Page, 'keyboard'>;
  const settled = routePulseSettledPredicate({
    authority: { acknowledgedInputSequence: 0 },
    nativeMovementInput: readNativeInput(owner, epoch),
  });
  const observation = () => ({
    player: [0, 32.6, 0] as const,
    serverPlayerPosition: [0, 32.6, 0] as const,
    serverPlayerVelocity: [0, 0, 0] as const,
    onGround: true,
    colliding: false,
    authority: { acknowledgedInputSequence: sequence },
    nativeMovementInput: readNativeInput(owner, epoch),
  });
  const pulse = sendNativeMovementPulse(page, 'KeyW', 300, true).then(() => {
    returned = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(900);
    expect(keys.has('KeyW')).toBe(false);
    expect(keys.has('Space')).toBe(true);
    expect(returned).toBe(false);
    expect(settled(observation())).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(keys.size).toBe(0);
    expect(returned).toBe(true);
    expect(settled(observation())).toBe(true);
    expect(settled({ ...observation(), authority: { acknowledgedInputSequence: sequence - 1 } })).toBe(false);
  } finally {
    await vi.runAllTimersAsync();
    await pulse;
  }
});
