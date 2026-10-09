import { expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { PlayerMiningState } from '../../../src/app/player/creative-break-cadence';
import { clickSingleBlockWithRealMouse } from './single-block-click';

const RESPONSE_DELAY_MS = 322;

function fixture() {
  const mining = new PlayerMiningState();
  let held = false;
  const requests: string[] = [];
  const begin = (elapsedSeconds: number, initial: boolean) => {
    if (!held) return;
    const targetKey = `${requests.length},61,17`;
    if (!mining.shouldBegin(targetKey, elapsedSeconds, initial)) return;
    mining.cancelActive();
    requests.push(targetKey);
    mining.recordBegin(targetKey, undefined);
  };
  const down = () => {
    held = true;
    mining.start('creative');
    begin(0, true);
  };
  const up = () => {
    held = false;
    mining.stop();
  };
  // Model only a render turn during the input API's after-call response delay.
  const delayedResponse = async () => begin(RESPONSE_DELAY_MS / 1000, false);
  const page = {
    locator: () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 960, height: 540 }) }),
    mouse: {
      down: async () => {
        down();
        await delayedResponse();
      },
      up: async () => up(),
      click: async () => {
        down();
        up();
        await delayedResponse();
      },
    },
  } as unknown as Page;
  return { page, requests, held: () => held, frame: () => begin(1, false), mining, press: down, release: up };
}

it('releases a single creative click before an input API response delay permits a second block request', async () => {
  const run = fixture();
  await clickSingleBlockWithRealMouse(run.page);
  expect(run.requests).toHaveLength(1);
  expect(run.held()).toBe(false);
  expect(run.mining.mode).toBe(null);
  run.frame();
  expect(run.requests).toHaveLength(1);
});

it('cleans up a failed native click and preserves its error if release also rejects', async () => {
  const run = fixture();
  const failure = new Error('native click failed');
  run.page.mouse.click = async () => {
    run.press();
    throw failure;
  };
  run.page.mouse.up = async () => {
    run.release();
    throw new Error('release response failed');
  };
  await expect(clickSingleBlockWithRealMouse(run.page)).rejects.toBe(failure);
  expect(run.held()).toBe(false);
  expect(run.mining.mode).toBe(null);
  run.frame();
  expect(run.requests).toHaveLength(1);
});
