import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('headless server command CLI', () => {
  it('runs a JSON-line command workflow without browser globals and survives invalid input', () => {
    const run = spawnSync('pnpm', ['--silent', 'server:headless', '--', '--seed', 'command-cli-test', '--json'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: ['/setblock 1 -20 1 wood', '/inspect voxel 1 -20 1', '/unknown', '/save', '/seed', ''].join('\n'),
      env: { ...process.env, CI: 'true' },
    });

    expect(run.status, run.stderr).toBe(0);
    const output = run.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(output).toHaveLength(5);
    expect(output[0]).toMatchObject({ success: true, worldRevision: 1 });
    expect(output[1]).toMatchObject({ success: true, data: { voxel: 4 } });
    expect(output[2]).toMatchObject({ success: false, error: { kind: 'parse' } });
    expect(output[3]).toMatchObject({ success: true, data: { savedChunks: ['0,-1,0'] } });
    expect(output[4]).toMatchObject({ success: true, data: { seedText: 'command-cli-test' } });
  });
});
