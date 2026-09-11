import { describe, expect, it } from 'vitest';
import { createEslint } from './eslint';

const lintPackageBoundary = async (source: string, filePath: string) => {
  const [result] = await createEslint().lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === 'seedlands/package-boundary');
};

describe('workspace public API and direction boundaries', () => {
  it('rejects cross-package relative paths, private paths and every prohibited dependency direction', async () => {
    await expect(
      lintPackageBoundary("import '../../stdlib/src/world/voxel';", 'packages/kernel/src/probe.ts'),
    ).resolves.toHaveLength(1);
    await expect(
      lintPackageBoundary("import '@seedlands/stdlib/mod-api';", 'packages/kernel/src/probe.ts'),
    ).resolves.toHaveLength(1);
    await expect(
      lintPackageBoundary("import '@seedlands/playbook-classic';", 'packages/stdlib/src/probe.ts'),
    ).resolves.toHaveLength(1);
    await expect(
      lintPackageBoundary("import '@seedlands/web';", 'apps/agent-server/src/probe.ts'),
    ).resolves.toHaveLength(1);
    await expect(
      lintPackageBoundary("import '@seedlands/agent-server';", 'apps/web/src/client/probe.ts'),
    ).resolves.toHaveLength(1);
    await expect(
      lintPackageBoundary("import '../../../node-server/src/node/server/node-server';", 'apps/web/src/client/probe.ts'),
    ).resolves.toHaveLength(1);
    await expect(
      lintPackageBoundary("import '@seedlands/stdlib/private/internal';", 'playbooks/classic/src/probe.ts'),
    ).resolves.toHaveLength(1);
  });

  it('covers dynamic import, TS import type and require bypasses', async () => {
    const messages = await lintPackageBoundary(
      `export const load = () => import('@seedlands/playbook-classic');
       export type Hidden = import('@seedlands/playbook-classic').pack;
       export const legacy = require('@seedlands/playbook-classic');`,
      'packages/stdlib/src/probe.ts',
    );
    expect(messages).toHaveLength(3);
  });

  it('allows declared, public dependencies through package names', async () => {
    expect(
      await lintPackageBoundary(
        "import type { ModModule } from '@seedlands/stdlib/mod-api'; export type Value = ModModule;",
        'playbooks/classic/src/probe.ts',
      ),
    ).toEqual([]);
    expect(
      await lintPackageBoundary(
        "import type { KernelRuntime } from '@seedlands/kernel/runtime'; export type Value = KernelRuntime;",
        'packages/stdlib/src/probe.ts',
      ),
    ).toEqual([]);
    expect(
      await lintPackageBoundary(
        "import './execution/local'; import type { KernelRuntime } from '@seedlands/kernel/runtime';",
        'packages/kernel/src/probe.ts',
      ),
    ).toEqual([]);
    expect(
      await lintPackageBoundary(
        "import '@seedlands/stdlib/runtime/character-control-protocol';",
        'packages/cognition-protocol/src/probe.ts',
      ),
    ).toEqual([]);
    expect(
      await lintPackageBoundary("import '@seedlands/kernel/internal/private';", 'packages/kernel/src/probe.ts'),
    ).toHaveLength(1);
  });

  it('requires apps to declare workspace dependencies and consume declared exports', async () => {
    expect(
      await lintPackageBoundary(
        "import '@seedlands/stdlib/host'; import '@seedlands/cognition-protocol';",
        'apps/web/src/client/probe.ts',
      ),
    ).toEqual([]);
    expect(
      await lintPackageBoundary(
        "import '@seedlands/eslint-plugin'; import '@seedlands/unknown/runtime'; import 'undici'; import '@seedlands/stdlib/private/internal';",
        'apps/web/src/client/probe.ts',
      ),
    ).toHaveLength(4);
    expect(
      await lintPackageBoundary(
        "import '@langchain/langgraph'; import 'ws'; import '@seedlands/cognition-protocol';",
        'apps/agent-server/src/probe.ts',
      ),
    ).toEqual([]);
    expect(
      await lintPackageBoundary("import '@seedlands/cognition-protocol';", 'packages/kernel/src/probe.ts'),
    ).toHaveLength(1);
  });
});
