import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const createEslint = () => new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });

const lintSource = async (source: string, filePath = 'src/app/module-size-probe.ts') => {
  const eslint = createEslint();
  return eslint.lintText(source, { filePath });
};

const effectiveLines = (count: number) =>
  Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join('\n');

const governedPaths = [
  'src/app/module-size-probe.ts',
  'src/world/module-size-probe.ts',
  'tests/governance/module-size-probe.test.ts',
  'scripts/module-size-probe.mjs',
  'changes/2026-09-04-app-module-boundaries/e2e/module-size-probe.spec.ts',
  'playwright.config.ts',
] as const;

describe('repository ESLint module size boundary', () => {
  it('rejects modules above 500 effective lines even with an inline disable', async () => {
    const [result] = await lintSource(`/* eslint-disable max-lines */\n${effectiveLines(501)}`);
    const sizeMessages = result.messages.filter((message) => message.ruleId === 'max-lines');

    expect(sizeMessages).toHaveLength(1);
    expect(sizeMessages[0]?.severity).toBe(2);
  });

  it('allows 500 effective lines and ignores comments or blank lines', async () => {
    const source = `${effectiveLines(500)}\n\n// 体量规则忽略说明文字。\n/* 也忽略块注释。 */`;
    const [result] = await lintSource(source);

    expect(result.messages.filter((message) => message.ruleId === 'max-lines')).toHaveLength(0);
  });

  it.each(governedPaths)('uses the exact global size options for %s', async (filePath) => {
    const config = await createEslint().calculateConfigForFile(filePath);

    expect(config?.rules?.['max-lines']).toEqual([
      2,
      {
        max: 500,
        skipBlankLines: true,
        skipComments: true,
      },
    ]);
    expect(config?.linterOptions?.noInlineConfig).toBe(true);
  });
});
