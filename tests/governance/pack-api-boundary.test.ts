import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const filePath = 'packages/game-core/src/server/gameplay/playbooks/probe/entry.ts';
const boundaryMessages = async (source: string, target = filePath) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  const [result] = await eslint.lintText(source, { filePath: target });
  return result.messages.filter((message) => message.ruleId === 'seedlands/pack-api-boundary');
};

describe('Pack public API boundary', () => {
  it.each([
    "import { GameServer } from '@seedlands/game-core/server/game-server'; export { GameServer };",
    "export * from '../../../game-server';",
    "export type { GameplayEntity } from '../../entity-store';",
    "export const load = () => import('../../../composition/world-composition');",
    "export const load = () => require('../../modules/inventory');",
    'export const load = (path: string) => import(path);',
    'export const load = () => import(`../../../game-server`);',
    "export * from '@seedlands/game-core/mod-api/../../server/game-server';",
    "export * from '../another-pack/private';",
    "export type Internal = import('../../../game-server').GameServer;",
  ])('rejects internal or unresolvable import: %s', async (source) => {
    expect(await boundaryMessages(source)).toHaveLength(1);
  });

  it.each([
    "export type { PackManifest } from '@seedlands/game-core/mod-api';",
    "export * from './content';",
    "export const load = () => import('./content');",
  ])('accepts the explicit facade and Pack-local modules: %s', async (source) => {
    expect(await boundaryMessages(source)).toHaveLength(0);
  });
});

it.each([
  'changes/2026-09-09-composable-overworld-playbook/examples/probe.ts',
  'changes/2026-09-10-npc-composable-baseline/examples/probe.ts',
])('applies the same public facade boundary to standalone Pack example %s', async (target) => {
  expect(await boundaryMessages("export * from '@seedlands/game-core/server/game-server';", target)).toHaveLength(1);
  expect(await boundaryMessages("export * from '../internal';", target)).toHaveLength(1);
  expect(await boundaryMessages("export * from './building-content';", target)).toHaveLength(0);
  expect(
    await boundaryMessages("export type { PackManifest } from '@seedlands/game-core/mod-api';", target),
  ).toHaveLength(0);
});
