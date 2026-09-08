import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REMOTE_PLAYABLE_SEED = 'mosslight-68';
export const REMOTE_PLAYABLE_ACCESS_KEY = 'seedlands-e2e-synthetic-key';

const MAX_LOG_LINES = 1_000;

export class RemotePlayableNodeFixture {
  readonly dataDirectory: string;
  readonly keyFile: string;
  readonly url: string;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly output: string[] = [];

  private constructor(dataDirectory: string, port: number) {
    this.dataDirectory = dataDirectory;
    this.keyFile = join(dataDirectory, 'access-key');
    this.url = `ws://127.0.0.1:${port}/seedlands`;
  }

  static async create(port: number): Promise<RemotePlayableNodeFixture> {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'seedlands-web-node-playable-'));
    const fixture = new RemotePlayableNodeFixture(dataDirectory, port);
    await writeFile(fixture.keyFile, `${REMOTE_PLAYABLE_ACCESS_KEY}\n`, { mode: 0o600 });
    return fixture;
  }

  logs(): readonly string[] {
    return [...this.output];
  }

  async start(origin: string): Promise<void> {
    if (this.process) throw new Error('The remote playable Node fixture is already running.');
    this.output.length = 0;
    const child = spawn(
      process.execPath,
      [
        'apps/node-server/dist/node-server.js',
        '--data-directory',
        this.dataDirectory,
        '--seed',
        REMOTE_PLAYABLE_SEED,
        '--compute',
        'inline',
        '--listen',
        new URL(this.url).host,
        '--origin',
        origin,
        '--access-key-file',
        this.keyFile,
      ],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
        env: { ...process.env, SEEDLANDS_E2E_PLAYABLE_DIAGNOSTICS: '1' },
      },
    );
    this.process = child;
    const append = (chunk: Buffer) => {
      this.output.push(...chunk.toString('utf8').split(/\r?\n/u).filter(Boolean));
      if (this.output.length > MAX_LOG_LINES) this.output.splice(0, this.output.length - MAX_LOG_LINES);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    await this.waitForOutput(child, '"kind":"ready"');
  }

  async stop(): Promise<readonly string[]> {
    const process = this.process;
    if (!process) return this.logs();
    this.process = null;
    process.kill('SIGINT');
    await new Promise<void>((resolveExit) => {
      const timer = setTimeout(() => process.kill('SIGKILL'), 10_000);
      process.once('exit', () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
    return this.logs();
  }

  async dispose(): Promise<void> {
    await this.stop();
    await rm(this.dataDirectory, { recursive: true, force: true });
  }

  private async waitForOutput(process: ChildProcessWithoutNullStreams, value: string): Promise<void> {
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`Node did not print ${value}.`)), 15_000);
      const inspect = () => {
        if (!this.output.some((line) => line.includes(value))) return;
        clearTimeout(timer);
        process.stdout.off('data', inspect);
        resolveReady();
      };
      process.stdout.on('data', inspect);
      process.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Node exited before ready with code ${String(code)}.`));
      });
    });
  }
}
