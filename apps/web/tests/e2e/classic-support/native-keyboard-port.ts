import { test, type Page } from '@playwright/test';
import type { NativeMovementPage } from './native-movement-pulse';
import type { ClassicSnapshot } from './harness-snapshot';
import { readClassicSnapshotInBrowser, readClassicVoxelInBrowser } from './snapshot-read';
import type { Point } from './scenario';

type NativeRoutePage = NativeMovementPage &
  Readonly<{ snapshot: () => Promise<ClassicSnapshot | null>; voxelAt: (target: Point) => Promise<number | null> }>;

const descriptions = new Map<string, Readonly<{ key: string; windowsVirtualKeyCode: number }>>([
  ['KeyW', { key: 'w', windowsVirtualKeyCode: 87 }],
  ['KeyS', { key: 's', windowsVirtualKeyCode: 83 }],
  ['Space', { key: ' ', windowsVirtualKeyCode: 32 }],
]);
const ports = new WeakMap<Page, Promise<NativeRoutePage>>();

/** Chromium's native keyboard protocol, also used by Playwright's RawKeyboardImpl.
 * Route releases must not await a trace DOM snapshot before being dispatched.
 * The public CDP calls remain in the retained trace; no DOM events are synthesized.
 */
export function nativeMovementPage(page: Page): Promise<NativeRoutePage> {
  let port = ports.get(page);
  if (port) return port;
  port = page
    .context()
    .newCDPSession(page)
    .then((session) => {
      const send = async (phase: 'down' | 'up', code: string) => {
        const description = descriptions.get(code);
        if (!description) throw new RangeError(`Unsupported native route key: ${code}`);
        const base = { modifiers: 0, ...description, code, location: 0 };
        await test.step(`Native route key${phase} ${code}`, () =>
          session.send(
            'Input.dispatchKeyEvent',
            phase === 'up'
              ? { type: 'keyUp', ...base }
              : {
                  type: 'keyDown',
                  ...base,
                  commands: [],
                  text: description.key,
                  unmodifiedText: description.key,
                  autoRepeat: false,
                  isKeypad: false,
                },
          ));
      };
      let observations = 0;
      let voxelObservations = 0;
      return {
        keyboard: { down: (code: string) => send('down', code), up: (code: string) => send('up', code) },
        voxelAt: (target: Point) =>
          test.step('Observe Classic voxel', async (step) => {
            if (target.length !== 3 || !target.every(Number.isFinite))
              throw new RangeError('Classic voxel coordinates must be finite.');
            const response = await session.send('Runtime.evaluate', {
              expression: `(${readClassicVoxelInBrowser.toString()})(${JSON.stringify(target)})`,
              returnByValue: true,
            });
            if (response.exceptionDetails)
              throw new Error(`Classic voxel evaluation failed: ${response.exceptionDetails.text}`);
            if (!('value' in response.result)) throw new Error('Classic voxel did not return by value.');
            const value = response.result.value as number | null;
            if (process.env.SEEDLANDS_CLASSIC_BENCHMARK !== '1')
              await step.attach(`classic-voxel-observation-${++voxelObservations}.json`, {
                contentType: 'application/json',
                body: Buffer.from(JSON.stringify({ target, value })),
              });
            return value;
          }),
        snapshot: () =>
          test.step('Observe Classic route snapshot', async (step) => {
            const withPhysics = process.env.SEEDLANDS_CLASSIC_BENCHMARK !== '1';
            const response = await session.send('Runtime.evaluate', {
              expression: `(${readClassicSnapshotInBrowser.toString()})(${withPhysics})`,
              returnByValue: true,
            });
            if (response.exceptionDetails)
              throw new Error(
                `Classic route snapshot evaluation failed: ${
                  response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
                }`,
              );
            if (!('value' in response.result)) throw new Error('Classic route snapshot did not return by value.');
            const current = response.result.value as ClassicSnapshot | null;
            // Retain correlated route evidence without a DOM capture before every read.
            // Periodic trace screenshots and snapshots on other real actions remain enabled.
            if (withPhysics)
              await step.attach(`classic-route-observation-${++observations}.json`, {
                contentType: 'application/json',
                body: Buffer.from(
                  JSON.stringify(
                    current === null
                      ? { snapshot: null }
                      : {
                          player: current.player,
                          serverPlayerPosition: current.serverPlayerPosition,
                          serverPlayerVelocity: current.serverPlayerVelocity,
                          viewAngles: current.viewAngles,
                          onGround: current.onGround,
                          colliding: current.colliding,
                          nativeMovementInput: current.nativeMovementInput,
                          authority: {
                            physicsTick: current.authority.physicsTick,
                            acknowledgedInputSequence: current.authority.acknowledgedInputSequence,
                          },
                          physicsDiagnostics: current.physicsDiagnostics ?? null,
                        },
                  ),
                ),
              });
            return current;
          }),
      };
    });
  ports.set(page, port);
  void port.catch(() => {
    if (ports.get(page) === port) ports.delete(page);
  });
  return port;
}
