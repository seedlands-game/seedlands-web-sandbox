import { createNodeServerRuntime } from './node-server-runtime';
import { parseNodeServerOptions } from './node-server-options';
import { runNodeServerLifecycle } from './node-server-lifecycle';

const emit = (event: Readonly<Record<string, unknown>>) => process.stdout.write(`${JSON.stringify(event)}\n`);

async function main() {
  const options = parseNodeServerOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Seedlands Node 世界宿主\n--data-directory <目录>  必填的独立世界存档目录\n--seed <种子>            新世界种子，默认 seedlands\n--compute <模式>         inline / worker-thread / child-process\n当前入口仅启动世界宿主；网络接入仍在实施。\n',
    );
    return;
  }
  await runNodeServerLifecycle(
    () =>
      createNodeServerRuntime({
        dataDirectory: options.dataDirectory,
        seedText: options.seedText,
        computeMode: options.computeMode,
        entries: {
          authority: new URL('./node-authority-worker.js', import.meta.url),
          persistence: new URL('./node-persistence-worker.js', import.meta.url),
          worker: new URL('./node-compute-worker.js', import.meta.url),
          child: new URL('./node-compute-child.js', import.meta.url),
        },
      }),
    {
      computeMode: options.computeMode,
      signals: process,
      emit,
      stopFailure: (error: unknown) => {
        process.stderr.write(`服务端关停失败：${error instanceof Error ? error.message : String(error)}\n`);
        // 达到关停预算即由进程退出释放资源；不得把未结束的写入宣称为 durable。
        process.exit(1);
      },
    },
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`服务端启动或运行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
