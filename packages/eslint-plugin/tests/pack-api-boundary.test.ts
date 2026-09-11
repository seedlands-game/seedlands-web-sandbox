import { describe, expect, it } from 'vitest';
import { createEslint } from './eslint';

const filePath = 'playbooks/classic/src/probe/entry.ts';
const boundaryMessages = async (source: string, target = filePath) => {
  const eslint = createEslint();
  const [result] = await eslint.lintText(source, { filePath: target });
  return result.messages.filter((message) => message.ruleId === 'seedlands/pack-api-boundary');
};

describe('Pack public API boundary', () => {
  it.each([
    "import { defineConfig } from 'vite'; export { defineConfig };",
    "export * from '../../../stdlib/private';",
    "export type { GameplayEntity } from '../../private/entity-store';",
    "export const load = () => import('../../../private/world-composition');",
    "export const load = () => require('../../private/inventory');",
    'export const load = (path: string) => import(path);',
    'export const load = () => import(`../../../game-server`);',
    "export * from '@seedlands/stdlib/mod-api/../../server/game-server';",
    "export * from '../../../modern/src/private';",
    "export type Internal = import('../../../private/game-server').GameServer;",
  ])('rejects internal or unresolvable import: %s', async (source) => {
    expect(await boundaryMessages(source)).toHaveLength(1);
  });

  it.each([
    "export type { PackManifest } from '@seedlands/stdlib/mod-api';",
    "export type { KernelRuntime } from '@seedlands/kernel/runtime';",
    "export { GameServer } from '@seedlands/stdlib/server/game-server';",
    "export * from './content';",
    "export const load = () => import('./content');",
  ])('accepts the explicit facade and Pack-local modules: %s', async (source) => {
    expect(await boundaryMessages(source)).toHaveLength(0);
  });
});

it('applies the same public facade boundary to another Playbook root', async () => {
  const target = 'playbooks/modern/src/probe.ts';
  expect(await boundaryMessages("export * from '@seedlands/stdlib/server/game-server';", target)).toHaveLength(0);
  expect(await boundaryMessages("export * from '../../classic/src/private';", target)).toHaveLength(1);
  expect(await boundaryMessages("export * from './content';", target)).toHaveLength(0);
  expect(await boundaryMessages("export type { PackManifest } from '@seedlands/stdlib/mod-api';", target)).toHaveLength(
    0,
  );
});
