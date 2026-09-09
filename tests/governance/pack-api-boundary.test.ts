import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const filePath = 'packages/game-core/src/server/gameplay/playbooks/probe/entry.ts';
const boundaryMessages = async (source: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  const [result] = await eslint.lintText(source, { filePath });
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
