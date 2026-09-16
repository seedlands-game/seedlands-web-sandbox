import { once } from 'node:events';
import { start as startRepl } from 'node:repl';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { buildGameplayPacks } from './build-gameplay-packs.mjs';
import { loadVerifiedPackArtifacts } from './pack-integrity.mjs';

const root = resolve(import.meta.dirname, '..');
function optionsFromArgs(args) {
  const options = { seed: 'seedlands-headless', json: false, repl: false, playbook: 'overworld' };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--') continue;
    if (args[index] === '--seed') {
      if (!args[index + 1]) throw new Error('--seed requires a value.');
      options.seed = args[++index];
    } else if (args[index] === '--playbook') {
      if (!args[index + 1]) throw new Error('--playbook requires a value.');
      options.playbook = args[++index];
    } else if (args[index] === '--json') options.json = true;
    else if (args[index] === '--repl') options.repl = true;
    else throw new Error(`Unknown option: ${args[index]}`);
  }
  if (options.json && options.repl) throw new Error('--json and --repl are mutually exclusive.');
  return options;
}

const options = optionsFromArgs(process.argv.slice(2));
const { lockPath } = await buildGameplayPacks(undefined, options.playbook);
const packArtifacts = await loadVerifiedPackArtifacts(lockPath);
const moduleRunner = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
let session;
try {
  const { HeadlessSession } = await moduleRunner.ssrLoadModule(
    '/packages/stdlib/src/server/headless/headless-session.ts',
  );
  const { dispatchWorldHarnessRpc, WORLD_HARNESS_JSONL_MAX_LINE_BYTES } = await moduleRunner.ssrLoadModule(
    '/packages/stdlib/src/server/harness/world-harness-jsonl.ts',
  );
  const { nodeCorePlatform } = await moduleRunner.ssrLoadModule('/scripts/headless/node-core-platform.ts');
  const { assembleProductPacks } = await moduleRunner.ssrLoadModule(
    '/packages/stdlib/src/server/composition/host-api.ts',
  );
  const { readBoundedLines, stringifyWorldJson, decodeCheckpointRequest, JSONL_CHECKPOINT_LINE_BYTES } =
    await moduleRunner.ssrLoadModule('/scripts/headless/jsonl-transport.ts');
  const write = async (value) => {
    if (!process.stdout.write(`${stringifyWorldJson(value)}\n`)) await once(process.stdout, 'drain');
  };
  const failure = (code, message, requestId = 0) => ({
    protocolVersion: 1,
    requestId,
    result: { ok: false, error: { kind: 'validation', code, message } },
  });
  session = await HeadlessSession.create({
    seedText: options.seed,
    platform: nodeCorePlatform,
    createComposition: () => assembleProductPacks(packArtifacts),
  });
  await session.world.clock({ kind: 'pause' });
  const interactive = options.repl || Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
  if (interactive) {
    session.startClock();
    process.stdout.write(
      `Seedlands trusted developer REPL · seed ${options.seed}\nworld is paused; await world.clock({kind:'run'}) starts the clock.\n`,
    );
    const repl = startRepl({
      prompt: '> ',
      useGlobal: false,
      ignoreUndefined: true,
      terminal: Boolean(process.stdin.isTTY),
    });
    repl.context.world = session.world;
    repl.defineCommand('command', {
      help: 'Run a legacy slash command, e.g. .command /seed',
      action(line) {
        session.executeLine(line).then(
          ({ result }) => {
            process.stdout.write(`${stringifyWorldJson(result)}\n`);
            this.displayPrompt();
          },
          (error) => {
            process.stderr.write(`${error.message}\n`);
            this.displayPrompt();
          },
        );
      },
    });
    await once(repl, 'exit');
  } else {
    // A single in-flight command and Readable backpressure bound the input queue.
    session.startClock();
    for await (const input of readBoundedLines(process.stdin, JSONL_CHECKPOINT_LINE_BYTES)) {
      if ('oversized' in input) {
        await write(failure('WORLD_RPC_LINE_TOO_LARGE', 'JSONL request exceeds 96 MiB.'));
        continue;
      }
      const line = input.line;
      if (!line.trim()) continue;
      let requestId = 0;
      try {
        if (line.trimStart().startsWith('{')) {
          let request;
          try {
            request = JSON.parse(line);
          } catch {
            await write(failure('WORLD_RPC_JSON_INVALID', 'Malformed JSON.'));
            continue;
          }
          if (Number.isSafeInteger(request?.requestId) && request.requestId >= 0) requestId = request.requestId;
          const checkpointRestore = request?.method === 'checkpoint' && request?.args?.[0]?.kind === 'restore';
          if (!checkpointRestore && Buffer.byteLength(line) > WORLD_HARNESS_JSONL_MAX_LINE_BYTES) {
            await write(failure('WORLD_RPC_LINE_TOO_LARGE', 'Non-checkpoint request exceeds 1 MiB.', requestId));
            continue;
          }
          await write(await dispatchWorldHarnessRpc(session.world, decodeCheckpointRequest(request)));
        } else if (Buffer.byteLength(line) > WORLD_HARNESS_JSONL_MAX_LINE_BYTES) {
          await write(failure('WORLD_RPC_LINE_TOO_LARGE', 'Legacy command exceeds 1 MiB.'));
        } else await write((await session.executeLine(line)).result);
      } catch (cause) {
        await write(failure('WORLD_RPC_INVALID', cause instanceof Error ? cause.message : String(cause), requestId));
      }
    }
  }
} finally {
  await session?.dispose();
  await moduleRunner.close();
}
