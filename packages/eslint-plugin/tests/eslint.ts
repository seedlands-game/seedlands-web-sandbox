import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { createSeedlandsConfig } from '../src/config.mjs';

export const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Tests use the package factory directly so the root integration file cannot mask a broken plugin. */
export const createEslint = () =>
  new ESLint({
    cwd: workspaceRoot,
    overrideConfigFile: true,
    overrideConfig: createSeedlandsConfig(workspaceRoot) as unknown as ESLint.Options['overrideConfig'],
  });
