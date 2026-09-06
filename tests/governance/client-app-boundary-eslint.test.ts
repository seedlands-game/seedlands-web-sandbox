import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lintSource = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  return eslint.lintText(source, { filePath });
};

describe('app/client directory ownership boundary', () => {
  it('rejects client imports from browser composition code', async () => {
    const [result] = await lintSource(
      `import { Game } from '../../app/game'; export const start = () => new Game();`,
      'src/client/presentation/client-app-boundary-probe.ts',
    );
    expect(result.messages.filter((message) => message.ruleId === 'seedlands/client-no-app-import')).toHaveLength(1);
  });

  it('rejects an app re-export disguised as a client contract', async () => {
    const [result] = await lintSource(
      `export * from '../../app/game';`,
      'src/client/presentation/client-app-re-export-probe.ts',
    );
    expect(result.messages.filter((message) => message.ruleId === 'seedlands/client-no-app-import')).toHaveLength(1);
  });

  it('allows app adapters to consume client contracts and client code to consume DTOs', async () => {
    const [appResult] = await lintSource(
      `import type { PerformanceProfile } from '../../client/presentation/performance-profile'; export type View = PerformanceProfile;`,
      'src/app/scene/app-client-boundary-probe.ts',
    );
    const [clientResult] = await lintSource(
      `import type { AuthoritySnapshot } from '../../server/authority/authority-session'; export type View = AuthoritySnapshot;`,
      'src/client/authority/client-server-dto-probe.ts',
    );
    expect(appResult.messages.filter((message) => message.ruleId === 'seedlands/client-no-app-import')).toHaveLength(0);
    expect(clientResult.messages.filter((message) => message.ruleId === 'seedlands/client-no-app-import')).toHaveLength(
      0,
    );
  });

  it('keeps app and client top levels limited to reviewed composition entries', async () => {
    const [appExtra] = await lintSource('export const extra = true;', 'src/app/unowned-probe.ts');
    const [clientExtra] = await lintSource('export const extra = true;', 'src/client/unowned-probe.ts');
    const [appEntry] = await lintSource('export const entry = true;', 'src/app/main.ts');

    expect(appExtra.messages.filter((message) => message.ruleId === 'seedlands/app-top-level-owner')).toHaveLength(1);
    expect(
      clientExtra.messages.filter((message) => message.ruleId === 'seedlands/client-top-level-owner'),
    ).toHaveLength(1);
    expect(appEntry.messages.filter((message) => message.ruleId === 'seedlands/app-top-level-owner')).toHaveLength(0);
  });
});
