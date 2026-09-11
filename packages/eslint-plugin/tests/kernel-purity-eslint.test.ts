import { describe, expect, it } from 'vitest';
import { createEslint } from './eslint';

const violations = async (source: string) => {
  const [result] = await createEslint().lintText(source, { filePath: 'packages/kernel/src/runtime/purity-probe.ts' });
  return result.messages.filter((message) => message.ruleId === 'seedlands/core-compute-purity');
};

describe('Kernel purity boundary', () => {
  it('rejects Node, stdlib, Playbook and gameplay dependencies through every static import form', async () => {
    const messages = await violations(`
      import { readFile } from 'node:fs/promises';
      export { createGameplayHost } from '@seedlands/stdlib/host';
      export type Pack = import('@seedlands/playbook-classic').pack;
      export const load = () => import('../gameplay/runtime');
      export const legacy = require('node:path');
    `);

    expect(messages).toHaveLength(5);
  });

  it('rejects browser, Worker and Node ambient globals', async () => {
    const messages = await violations(`
      document.createElement('canvas');
      const worker = new Worker('runtime-worker.ts');
      process.nextTick(() => undefined);
      const bytes = Buffer.alloc(8);
      export type HostElement = HTMLElement;
      export { bytes, worker };
    `);

    expect(messages).toHaveLength(5);
  });

  it('allows neutral Kernel contracts and locally bound names', async () => {
    const messages = await violations(`
      import type { RuntimePort } from './runtime-port';
      const process = { revision: 1 };
      export type Observation = { self: { id: number } };
      export const state = { process, self: 'actor' };
    `);

    expect(messages).toHaveLength(0);
  });
});
