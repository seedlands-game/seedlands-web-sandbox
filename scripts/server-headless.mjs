import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');

function optionsFromArgs(args) {
  const options = { seed: 'seedlands-headless', json: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--') continue;
    if (args[index] === '--seed') {
      if (!args[index + 1]) throw new Error('--seed requires a value.');
      options.seed = args[++index];
    } else if (args[index] === '--json') options.json = true;
    else throw new Error(`Unknown option: ${args[index]}`);
  }
  return options;
}

const options = optionsFromArgs(process.argv.slice(2));
const moduleRunner = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { HeadlessSession } = await moduleRunner.ssrLoadModule(
    '/packages/game-core/src/server/headless/headless-session.ts',
  );
  const { nodeCorePlatform } = await moduleRunner.ssrLoadModule('/scripts/headless/node-core-platform.ts');
  const session = await HeadlessSession.create({ seedText: options.seed, platform: nodeCorePlatform });
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
  const lines = createInterface({
    input: process.stdin,
    output: interactive ? process.stdout : undefined,
    terminal: interactive,
  });
  if (interactive) {
    process.stdout.write(`Seedlands headless server · seed ${options.seed}\n`);
    lines.setPrompt('> ');
    lines.prompt();
  }
  for await (const line of lines) {
    if (!line.trim()) {
      if (interactive) lines.prompt();
      continue;
    }
    const execution = await session.executeLine(line);
    if (interactive) {
      const result = execution.result;
      process.stdout.write(`${result.success ? 'OK' : 'ERROR'} · ${result.message ?? result.error.message}\n`);
      lines.prompt();
    } else process.stdout.write(`${JSON.stringify(execution.result)}\n`);
  }
} finally {
  await moduleRunner.close();
}
