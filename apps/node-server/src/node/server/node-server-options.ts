export type NodeServerOptions = Readonly<{
  help: boolean;
  dataDirectory: string;
  seedText: string;
  computeMode: 'inline' | 'worker-thread' | 'child-process';
}>;

export function parseNodeServerOptions(args: readonly string[]): NodeServerOptions {
  let dataDirectory = '';
  let seedText = 'seedlands';
  let computeMode: NodeServerOptions['computeMode'] = 'worker-thread';
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (!['--data-directory', '--seed', '--compute'].includes(argument)) throw new Error(`未知启动参数：${argument}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`启动参数缺少值：${argument}`);
    if (argument === '--data-directory') dataDirectory = value;
    else if (argument === '--seed') seedText = value;
    else if (value === 'inline' || value === 'worker-thread' || value === 'child-process') computeMode = value;
    else throw new Error('计算模式必须是 inline、worker-thread 或 child-process。');
  }
  if (!help && !dataDirectory.trim()) throw new Error('必须通过 --data-directory 明确指定世界存档目录。');
  if (!seedText.trim() || seedText.length > 256) throw new Error('世界种子长度必须在 1 到 256 个字符之间。');
  return { help, dataDirectory, seedText, computeMode };
}
