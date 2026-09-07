import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_PACKAGE = 'world-kernels';
export const WASM_ADAPTER_PACKAGE = 'world-kernels-wasm';

const FORBIDDEN_CORE_PACKAGES = new Set([
  'async-std',
  'js-sys',
  'napi',
  'napi-derive',
  'reqwest',
  'socket2',
  'stdweb',
  'tokio',
  'ureq',
  'wasm-bindgen',
  'wasm-bindgen-futures',
  'web-sys',
]);

const FORBIDDEN_CORE_SOURCE_PATTERNS = [
  { pattern: /\bstd::(?:net|fs|process|thread|env|os|time)\b/g, reason: 'core 禁止依赖 std 宿主 API' },
  { pattern: /\b(?:wasm_bindgen|wasm-bindgen|js_sys|web_sys|napi)\b/g, reason: 'core 禁止导入 Wasm/JS/N-API 宿主' },
  {
    pattern: /\b(?:WebAssembly|fetch\s*\(|TcpStream|UdpSocket|std::net|std::fs|std::process)\b/g,
    reason: 'core 禁止网络、文件或浏览器宿主 API',
  },
  { pattern: /\bcore::arch::wasm32\b/g, reason: 'core 禁止直接绑定 Wasm SIMD/地址，代码应留在 adapter' },
  { pattern: /\bcore::slice::from_raw_parts(?:_mut)?\b/g, reason: 'core 禁止从固定地址构造 Wasm slice' },
  { pattern: /\bas\s+\*const\s+|\bas\s+\*mut\s+/g, reason: 'core 禁止固定地址裸指针转换' },
  { pattern: /\bextern\s+"(?:C|wasm)"/g, reason: 'core 禁止宿主 ABI 导出或外部函数' },
];

const packageNameById = (metadata) => new Map((metadata.packages ?? []).map((pkg) => [pkg.id, pkg.name]));

const dependencyId = (dependency) =>
  typeof dependency === 'string' ? dependency : (dependency?.pkg ?? dependency?.id ?? null);

const dependencyIdsById = (metadata) =>
  new Map(
    (metadata.resolve?.nodes ?? []).map((node) => [
      node.id,
      (node.dependencies ?? []).map(dependencyId).filter((id) => id !== null),
    ]),
  );

const directPackageDependencies = (metadata, packageName) => {
  const pkg = (metadata.packages ?? []).find((candidate) => candidate.name === packageName);
  return new Set((pkg?.dependencies ?? []).map((dependency) => dependency.name).filter(Boolean));
};

function sourceViolations(source, label) {
  const violations = [];
  for (const { pattern, reason } of FORBIDDEN_CORE_SOURCE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) violations.push(`${label}: ${reason} (${pattern.source})`);
  }
  return violations;
}

function reachablePackageNames(metadata, startId) {
  const names = packageNameById(metadata);
  const dependencies = dependencyIdsById(metadata);
  const seen = new Set();
  const pending = [startId];
  while (pending.length) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const dependency of dependencies.get(id) ?? []) pending.push(dependency);
  }
  return [...seen].map((id) => names.get(id) ?? id).sort();
}

/**
 * Audits supplied Cargo metadata and source snippets without invoking Cargo.
 * The source arguments are intentionally injectable so governance tests can
 * exercise both permitted and forbidden fixtures without creating crates.
 */
export function auditRustKernelBoundary({
  metadata,
  coreSource = '',
  adapterSource = '',
  corePackage = CORE_PACKAGE,
  adapterPackage = WASM_ADAPTER_PACKAGE,
}) {
  const violations = [];
  const packageByName = new Map((metadata.packages ?? []).map((pkg) => [pkg.name, pkg]));
  const core = packageByName.get(corePackage);
  const adapter = packageByName.get(adapterPackage);
  if (!core) violations.push(`Cargo metadata 缺少 core package ${corePackage}`);
  if (!adapter) violations.push(`Cargo metadata 缺少 Wasm adapter package ${adapterPackage}`);
  if (!metadata.resolve?.nodes) violations.push('Cargo metadata 缺少 resolve.nodes，无法验证传递依赖');

  const coreId = core?.id;
  const adapterId = adapter?.id;
  const coreReachable = coreId ? reachablePackageNames(metadata, coreId) : [];
  for (const packageName of new Set([...coreReachable, ...directPackageDependencies(metadata, corePackage)])) {
    if (FORBIDDEN_CORE_PACKAGES.has(packageName)) violations.push(`core 传递依赖包含禁止宿主 crate：${packageName}`);
  }
  if (directPackageDependencies(metadata, corePackage).has(adapterPackage))
    violations.push(`core 不得依赖 Wasm adapter：${corePackage} -> ${adapterPackage}`);

  if (coreId && adapterId) {
    const dependencies = dependencyIdsById(metadata);
    const adapterReachable = new Set(reachablePackageNames(metadata, adapterId));
    if (!adapterReachable.has(corePackage)) violations.push(`Wasm adapter 必须依赖 ${corePackage}`);
    const coreDeps = dependencies.get(coreId) ?? [];
    if (coreDeps.includes(adapterId))
      violations.push(`Cargo resolve 发现反向依赖：${corePackage} -> ${adapterPackage}`);
  }

  violations.push(...sourceViolations(coreSource, `${corePackage} 源码`));
  // adapterSource is intentionally not scanned with the core deny-list:
  // core::arch::wasm32 is allowed at this one-way boundary.
  void adapterSource;
  return { ok: violations.length === 0, violations, coreReachable };
}

function collectRustSource(root, packageName) {
  const directory = join(root, 'crates', packageName, 'src');
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.rs')) files.push(path);
    }
  };
  visit(directory);
  return files
    .sort()
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function cargoMetadata(root, run) {
  const result = run(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--all-features',
      '--locked',
      '--manifest-path',
      join(root, 'crates/Cargo.toml'),
    ],
    {
      cwd: join(root, 'crates'),
      encoding: 'utf8',
    },
  );
  if (result.status !== 0)
    throw new Error(`cargo metadata 失败（exit ${result.status}）\n${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

/** Runs the bounded governance check; it invokes Cargo metadata, never cargo build. */
export function checkRustKernelBoundary({
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  run,
} = {}) {
  const execute =
    run ??
    ((command, args, options) => {
      const result = spawnSync(command, args, options);
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    });
  const metadata = cargoMetadata(rootDir, execute);
  const result = auditRustKernelBoundary({
    metadata,
    coreSource: collectRustSource(rootDir, CORE_PACKAGE),
    adapterSource: collectRustSource(rootDir, WASM_ADAPTER_PACKAGE),
  });
  if (!result.ok) throw new Error(`Rust kernel boundary 检查失败：\n- ${result.violations.join('\n- ')}`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = checkRustKernelBoundary();
    process.stdout.write(`Rust kernel boundary passed; core closure: ${result.coreReachable.join(', ')}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
