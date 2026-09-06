import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// @ts-expect-error The CLI helpers are executable JavaScript modules and are exercised through Vitest.
import { ToolchainResolutionError, resolveMoonBitToolchain } from '../../scripts/moonbit-toolchain.mjs';
// @ts-expect-error The CLI helpers are executable JavaScript modules and are exercised through Vitest.
import { buildWasmPackages, discoverWasmPackages } from '../../scripts/build-wasm.mjs';
// @ts-expect-error The CLI helpers are executable JavaScript modules and are exercised through Vitest.
import { checkMoonBit } from '../../scripts/check-wasm.mjs';

const root = resolve(import.meta.dirname, '../..');
type FakeRunOptions = { cwd?: string; env?: Record<string, string | undefined> };
type FakeResult = { stdout: string; stderr: string; status: number };

describe('MoonBit Wasm toolchain governance', () => {
  it('records the downloaded toolchain and core hashes', async () => {
    const lock = JSON.parse(await readFile(resolve(root, 'wasm/toolchain-lock.json'), 'utf8')) as {
      schemaVersion: number;
      toolchain: {
        moonVersion: string;
        mooncVersion: string;
        coreVersion: string;
        archiveSha256: string;
        coreArchiveSha256: string;
        moonWasmOptVersion: string;
        moonWasmOptBinarySha256: string;
      };
    };

    expect(lock.schemaVersion).toBe(1);
    expect(lock.toolchain).toMatchObject({
      moonVersion: '0.1.20260827',
      mooncVersion: '0.10.11+6ff76a5f9',
      coreVersion: '0.10.11+6ff76a5f9',
      archiveSha256: '9f617c9ae78b08e19354e70a4203c2157ff5373c78c340aebe722883441ae5b5',
      coreArchiveSha256: '661425df9bb8ff7cb1497dd3cb28a873b5a476fb3b07c587a225453ffd0aa9b4',
      moonWasmOptVersion: '125',
      moonWasmOptBinarySha256: '394fdb64405f14799aa3b21b7ce775c4bc62dba7517a6aec93c31c06240ad718',
    });
  });

  it('fails clearly when no fixed toolchain is available', async () => {
    await expect(
      resolveMoonBitToolchain({
        env: {},
        homeDirectory: '/tmp/no-seedlands-home',
        exists: () => false,
        run: () => ({ stdout: '', stderr: '', status: 0 }),
      }),
    ).rejects.toThrow(ToolchainResolutionError);
  });

  it('requires the selected toolchain versions to match the lock', async () => {
    await expect(
      resolveMoonBitToolchain({
        lockPath: '/fixed/lock.json',
        env: { SEEDLANDS_MOON_HOME: '/fixed/moon' },
        exists: (path: string) =>
          path === '/fixed/moon/bin/moon' ||
          path === '/fixed/moon/bin/moonc' ||
          path === '/fixed/moon/bin/moon-wasm-opt' ||
          path === '/fixed/moon/lib/core/moon.mod',
        readText: async (path: string) =>
          path === '/fixed/lock.json'
            ? readFile(resolve(root, 'wasm/toolchain-lock.json'), 'utf8')
            : 'name = "moonbitlang/core"\nversion = "0.10.11+6ff76a5f9"\n',
        run: (command: string) =>
          command.endsWith('/moon')
            ? { stdout: 'moon 0.1.20260827\n', stderr: '', status: 0 }
            : command.endsWith('/moon-wasm-opt')
              ? { stdout: 'wasm-opt version 125 (version_125)\n', stderr: '', status: 0 }
              : { stdout: 'v0.10.10\n', stderr: '', status: 0 },
      }),
    ).rejects.toThrow(/moonc version mismatch/);
  });

  it('rejects a same-version toolchain with a different binary hash', async () => {
    await expect(
      resolveMoonBitToolchain({
        lockPath: '/fixed/lock.json',
        env: { SEEDLANDS_MOON_HOME: '/fixed/moon' },
        exists: (path: string) =>
          path === '/fixed/moon/bin/moon' ||
          path === '/fixed/moon/bin/moonc' ||
          path === '/fixed/moon/bin/moon-wasm-opt' ||
          path === '/fixed/moon/lib/core/moon.mod',
        readText: async (path: string) =>
          path === '/fixed/lock.json'
            ? readFile(resolve(root, 'wasm/toolchain-lock.json'), 'utf8')
            : 'name = "moonbitlang/core"\nversion = "0.10.11+6ff76a5f9"\n',
        run: (command: string) =>
          command.endsWith('/moon')
            ? { stdout: 'moon 0.1.20260827\n', stderr: '', status: 0 }
            : command.endsWith('/moon-wasm-opt')
              ? { stdout: 'wasm-opt version 125 (version_125)\n', stderr: '', status: 0 }
              : { stdout: 'v0.10.11+6ff76a5f9\n', stderr: '', status: 0 },
        hashFile: () => 'different-binary',
      }),
    ).rejects.toThrow(/moon binary hash mismatch/);
  });

  it('rejects a same-version toolchain with a different optimizer hash', async () => {
    await expect(
      resolveMoonBitToolchain({
        lockPath: '/fixed/lock.json',
        env: { SEEDLANDS_MOON_HOME: '/fixed/moon' },
        exists: (path: string) =>
          path === '/fixed/moon/bin/moon' ||
          path === '/fixed/moon/bin/moonc' ||
          path === '/fixed/moon/bin/moon-wasm-opt' ||
          path === '/fixed/moon/lib/core/moon.mod',
        readText: async (path: string) =>
          path === '/fixed/lock.json'
            ? readFile(resolve(root, 'wasm/toolchain-lock.json'), 'utf8')
            : 'name = "moonbitlang/core"\nversion = "0.10.11+6ff76a5f9"\n',
        run: (command: string) =>
          command.endsWith('/moon')
            ? { stdout: 'moon 0.1.20260827\n', stderr: '', status: 0 }
            : command.endsWith('/moon-wasm-opt')
              ? { stdout: 'wasm-opt version 125 (version_125)\n', stderr: '', status: 0 }
              : { stdout: 'v0.10.11+6ff76a5f9\n', stderr: '', status: 0 },
        hashFile: (path: string) =>
          path.endsWith('/moon-wasm-opt')
            ? 'different-optimizer'
            : path.endsWith('/moon')
              ? '6a38e05cd85c8ad6c8f49d6a504fb245fce4ed13b9859275e3d653cec4207f33'
              : 'ea0798dd71f6b83708577fd1b046467ebff069ec3fbebf2dc34d7dc388f4ac7c',
      }),
    ).rejects.toThrow(/moon-wasm-opt binary hash mismatch/);
  });

  it('returns the locked optimizer path for post-opt builds', async () => {
    const toolchain = await resolveMoonBitToolchain({
      lockPath: '/fixed/lock.json',
      env: { SEEDLANDS_MOON_HOME: '/fixed/moon' },
      exists: () => true,
      readText: async (path: string) =>
        path === '/fixed/lock.json'
          ? readFile(resolve(root, 'wasm/toolchain-lock.json'), 'utf8')
          : 'name = "moonbitlang/core"\nversion = "0.10.11+6ff76a5f9"\n',
      run: (command: string) =>
        command.endsWith('/moon')
          ? { stdout: 'moon 0.1.20260827\n', stderr: '', status: 0 }
          : command.endsWith('/moon-wasm-opt')
            ? { stdout: 'wasm-opt version 125 (version_125)\n', stderr: '', status: 0 }
            : { stdout: 'v0.10.11+6ff76a5f9\n', stderr: '', status: 0 },
      hashFile: (path: string) =>
        path.endsWith('/moon')
          ? '6a38e05cd85c8ad6c8f49d6a504fb245fce4ed13b9859275e3d653cec4207f33'
          : path.endsWith('/moonc')
            ? 'ea0798dd71f6b83708577fd1b046467ebff069ec3fbebf2dc34d7dc388f4ac7c'
            : '394fdb64405f14799aa3b21b7ce775c4bc62dba7517a6aec93c31c06240ad718',
    });
    expect(toolchain.optimizer).toBe('/fixed/moon/bin/moon-wasm-opt');
    expect(toolchain.versions.moonWasmOpt).toBe('125');
  });

  it('builds every discovered package with the release wasm target', async () => {
    const calls: string[][] = [];
    const packages = discoverWasmPackages({
      packageDirectories: [
        '/repo/wasm/seedlands-kernels/geometry',
        '/repo/wasm/seedlands-kernels/geometry_test',
        '/repo/wasm/seedlands-kernels/main',
        '/repo/wasm/seedlands-kernels/fluid',
      ],
      packageName: (directory: string) => directory.split('/').at(-1) ?? '',
    });

    expect(packages).toEqual(['geometry', 'fluid']);

    await buildWasmPackages({
      repoRoot: '/repo',
      kernelRoot: '/repo/wasm/seedlands-kernels',
      outputRoot: '/repo/src/generated/wasm',
      packages,
      toolchain: {
        moon: '/fixed/moon/bin/moon',
        optimizer: '/fixed/moon/bin/moon-wasm-opt',
        env: { MOON_HOME: '/fixed/moon' },
      },
      run: (command: string, args: string[], options: FakeRunOptions): FakeResult => {
        calls.push([command, ...args, options.cwd ?? '']);
        return { stdout: '', stderr: '', status: 0 };
      },
      listFiles: () => [
        '/repo/wasm/seedlands-kernels/_build/wasm/release/build/geometry/geometry.wasm',
        '/repo/wasm/seedlands-kernels/_build/wasm/release/build/fluid/fluid.wasm',
      ],
      copy: () => undefined,
      mkdir: () => undefined,
      rename: () => undefined,
      remove: () => undefined,
      temporaryPath: (target: string) =>
        target.includes('/geometry.') ? '/tmp/geometry.optimized.wasm' : '/tmp/fluid.optimized.wasm',
    });

    expect(calls).toEqual([
      [
        '/fixed/moon/bin/moon',
        'build',
        '--release',
        '--target',
        'wasm',
        'geometry',
        'fluid',
        '/repo/wasm/seedlands-kernels',
      ],
      [
        '/fixed/moon/bin/moon-wasm-opt',
        '/repo/src/generated/wasm/geometry.wasm',
        '-O3',
        '--enable-bulk-memory',
        '--enable-reference-types',
        '--enable-multivalue',
        '-o',
        '/tmp/geometry.optimized.wasm',
        '/repo/wasm/seedlands-kernels',
      ],
      [
        '/fixed/moon/bin/moon-wasm-opt',
        '/repo/src/generated/wasm/fluid.wasm',
        '-O3',
        '--enable-bulk-memory',
        '--enable-reference-types',
        '--enable-multivalue',
        '-o',
        '/tmp/fluid.optimized.wasm',
        '/repo/wasm/seedlands-kernels',
      ],
    ]);
  });

  it('maps the single root kernel package to the fixed generated wasm path', async () => {
    const calls: string[][] = [];
    const copied: string[][] = [];
    const packages = discoverWasmPackages({ packageDirectories: ['/repo/wasm/seedlands-kernels'] });
    expect(packages).toEqual(['seedlands-kernels']);

    await buildWasmPackages({
      kernelRoot: '/repo/wasm/seedlands-kernels',
      outputRoot: '/repo/src/generated/wasm',
      packages,
      packageSelectors: ['.'],
      toolchain: {
        moon: '/fixed/moon/bin/moon',
        optimizer: '/fixed/moon/bin/moon-wasm-opt',
        env: { MOON_HOME: '/fixed/moon' },
      },
      run: (command: string, args: string[], options: FakeRunOptions): FakeResult => {
        calls.push([command, ...args, options.cwd ?? '']);
        return { stdout: '', stderr: '', status: 0 };
      },
      listFiles: () => ['/repo/wasm/seedlands-kernels/_build/wasm/release/build/kernels.wasm'],
      copy: (source: string, target: string) => copied.push([source, target]),
      mkdir: () => undefined,
      rename: () => undefined,
      remove: () => undefined,
      temporaryPath: () => '/tmp/seedlands-kernels.optimized.wasm',
    });

    expect(calls).toEqual([
      ['/fixed/moon/bin/moon', 'build', '--release', '--target', 'wasm', '.', '/repo/wasm/seedlands-kernels'],
      [
        '/fixed/moon/bin/moon-wasm-opt',
        '/repo/src/generated/wasm/seedlands-kernels.wasm',
        '-O3',
        '--enable-bulk-memory',
        '--enable-reference-types',
        '--enable-multivalue',
        '-o',
        '/tmp/seedlands-kernels.optimized.wasm',
        '/repo/wasm/seedlands-kernels',
      ],
    ]);
    expect(copied).toEqual([
      [
        '/repo/wasm/seedlands-kernels/_build/wasm/release/build/kernels.wasm',
        '/repo/src/generated/wasm/seedlands-kernels.wasm',
      ],
    ]);
  });

  it('checks MoonBit source with check and fmt check', async () => {
    const calls: string[][] = [];

    await checkMoonBit({
      kernelRoot: '/repo/wasm/seedlands-kernels',
      toolchain: { moon: '/fixed/moon/bin/moon', env: { MOON_HOME: '/fixed/moon' } },
      run: (command: string, args: string[], options: FakeRunOptions): FakeResult => {
        calls.push([command, ...args, options.cwd ?? '']);
        return { stdout: '', stderr: '', status: 0 };
      },
    });

    expect(calls).toEqual([
      ['/fixed/moon/bin/moon', 'check', '--target', 'wasm', '/repo/wasm/seedlands-kernels'],
      ['/fixed/moon/bin/moon', 'fmt', '--check', '/repo/wasm/seedlands-kernels'],
    ]);
  });
});
