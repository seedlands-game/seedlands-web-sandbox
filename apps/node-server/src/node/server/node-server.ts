import { createNodeServerRuntime } from './node-server-runtime';
import { parseNodeServerOptions } from './node-server-options';
import { runNodeServerLifecycle } from './node-server-lifecycle';
import { createNodePlayableNetworkServer } from './node-playable-network-server';

const emit = (event: Readonly<Record<string, unknown>>) => process.stdout.write(`${JSON.stringify(event)}\n`);

async function main() {
  const options = parseNodeServerOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Seedlands Node 世界宿主\n--data-directory <目录>  必填的独立世界存档目录\n--seed <种子>            新世界种子，默认 seedlands\n--compute <模式>         inline / worker-thread / child-process\n--listen <地址:端口>     实验入口，仅 127.0.0.1 或 ::1\n--origin <Origin>        精确允许的浏览器 http/https Origin\n--access-key-file <路径> 访问口令文件；与网络选项同时提供\n',
    );
    return;
  }
  await runNodeServerLifecycle(
    async () => {
      const runtime = await createNodeServerRuntime({
        dataDirectory: options.dataDirectory,
        seedText: options.seedText,
        computeMode: options.computeMode,
        entries: {
          authority: new URL('./node-authority-worker.js', import.meta.url),
          persistence: new URL('./node-persistence-worker.js', import.meta.url),
          worker: new URL('./node-compute-worker.js', import.meta.url),
          child: new URL('./node-compute-child.js', import.meta.url),
        },
      });
      if (options.network) {
        try {
          const network = await createNodePlayableNetworkServer(runtime.authority, {
            ...options.network,
            ...(process.env.SEEDLANDS_E2E_PLAYABLE_DIAGNOSTICS === '1' ? { diagnostic: emit } : {}),
          });
          runtime.attachNetwork(() => network.close());
          emit({ kind: 'network-ready', url: network.url, transport: 'experimental-local-c0-v1' });
        } catch (error) {
          await runtime.stop().catch(() => undefined);
          throw error;
        }
      }
      return runtime;
    },
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
