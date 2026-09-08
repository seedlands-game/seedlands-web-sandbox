export type NodeServerOptions = Readonly<{
  help: boolean;
  dataDirectory: string;
  seedText: string;
  computeMode: 'inline' | 'worker-thread' | 'child-process';
  network: Readonly<{ hostname: '127.0.0.1' | '::1'; port: number; origin: string; accessKeyFile: string }> | null;
}>;

export function parseNodeServerOptions(args: readonly string[]): NodeServerOptions {
  let dataDirectory = '';
  let seedText = 'seedlands';
  let computeMode: NodeServerOptions['computeMode'] = 'worker-thread';
  let help = false;
  let listen = '';
  let origin = '';
  let accessKeyFile = '';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (!['--data-directory', '--seed', '--compute', '--listen', '--origin', '--access-key-file'].includes(argument))
      throw new Error(`未知启动参数：${argument}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`启动参数缺少值：${argument}`);
    if (argument === '--data-directory') dataDirectory = value;
    else if (argument === '--seed') seedText = value;
    else if (argument === '--listen') listen = value;
    else if (argument === '--origin') origin = value;
    else if (argument === '--access-key-file') accessKeyFile = value;
    else if (value === 'inline' || value === 'worker-thread' || value === 'child-process') computeMode = value;
    else throw new Error('计算模式必须是 inline、worker-thread 或 child-process。');
  }
  if (!help && !dataDirectory.trim()) throw new Error('必须通过 --data-directory 明确指定世界存档目录。');
  if (!seedText.trim() || seedText.length > 256) throw new Error('世界种子长度必须在 1 到 256 个字符之间。');
  const networkFields = [listen, origin, accessKeyFile].filter(Boolean).length;
  if (networkFields !== 0 && networkFields !== 3)
    throw new Error('启用网络必须同时提供 --listen、--origin 与 --access-key-file。');
  let network: NodeServerOptions['network'] = null;
  if (networkFields === 3) {
    const separator = listen.lastIndexOf(':');
    const hostname = listen.slice(0, separator);
    const port = Number(listen.slice(separator + 1));
    if ((hostname !== '127.0.0.1' && hostname !== '::1') || !Number.isSafeInteger(port) || port < 1 || port > 65535)
      throw new Error('网络监听必须是明确的 loopback 地址与有效端口。');
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('Origin 必须是有效的 http/https URL。');
    }
    if ((parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') || parsedOrigin.origin !== origin)
      throw new Error('Origin 必须是精确的 http/https origin。');
    network = { hostname, port, origin, accessKeyFile };
  }
  return { help, dataDirectory, seedText, computeMode, network };
}
