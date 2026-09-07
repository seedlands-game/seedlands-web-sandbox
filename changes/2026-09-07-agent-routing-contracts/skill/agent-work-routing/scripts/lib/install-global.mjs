import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const startMarker = '<!-- agent-work-routing:start -->';
const endMarker = '<!-- agent-work-routing:end -->';

async function exists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function inject(original, snippet) {
  const block = `${startMarker}\n${snippet.trimEnd()}\n${endMarker}`;
  const start = original.indexOf(startMarker);
  if (start >= 0) {
    const end = original.indexOf(endMarker, start);
    if (end < 0) throw new Error('AGENTS.md 中存在不完整的 agent-work-routing 标记');
    return `${original.slice(0, start)}${block}${original.slice(end + endMarker.length)}`;
  }
  const separator = original.length === 0 || original.endsWith('\n') ? '' : '\n';
  return `${original}${separator}${block}\n`;
}

async function hashes(root, base = root) {
  const output = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(output, await hashes(absolute, base));
    else if (entry.isFile())
      output[path.relative(base, absolute)] = createHash('sha256')
        .update(await readFile(absolute))
        .digest('hex');
  }
  return output;
}

export async function restoreGlobal({ backupDir }) {
  const manifest = JSON.parse(await readFile(path.join(backupDir, 'restore.json'), 'utf8'));
  await rm(manifest.target, { recursive: true, force: true });
  if (manifest.hadSkill) await cp(path.join(backupDir, 'skill-original'), manifest.target, { recursive: true });
  if (manifest.hadAgents) await cp(path.join(backupDir, 'AGENTS.original.md'), manifest.agentsPath);
  else await rm(manifest.agentsPath, { force: true });
  return { restored: true, target: manifest.target, agentsPath: manifest.agentsPath };
}

export async function installGlobal({
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  apply = false,
} = {}) {
  const home = path.resolve(codexHome);
  const target = path.join(home, 'skills', 'agent-work-routing');
  const agentsPath = path.join(home, 'AGENTS.md');
  if (path.resolve(sourceRoot) === path.resolve(target)) throw new Error('版本化源与安装目标不能相同');
  const plan = { applied: false, source: sourceRoot, target, agentsPath };
  if (!apply) return plan;

  const backupDir = path.join(
    home,
    'backups',
    'agent-work-routing',
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const hadSkill = await exists(target);
  const hadAgents = await exists(agentsPath);
  if (hadSkill) await cp(target, path.join(backupDir, 'skill-original'), { recursive: true });
  if (hadAgents) await cp(agentsPath, path.join(backupDir, 'AGENTS.original.md'));
  await writeFile(
    path.join(backupDir, 'restore.json'),
    `${JSON.stringify({ target, agentsPath, hadSkill, hadAgents }, null, 2)}\n`,
    { mode: 0o600 },
  );

  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(sourceRoot, target, { recursive: true });
  const originalAgents = hadAgents ? await readFile(agentsPath, 'utf8') : '';
  const snippet = await readFile(path.join(sourceRoot, 'references', 'global-agents-snippet.md'), 'utf8');
  await writeFile(agentsPath, inject(originalAgents, snippet));
  await writeFile(path.join(backupDir, 'installed-hashes.json'), `${JSON.stringify(await hashes(target), null, 2)}\n`, {
    mode: 0o600,
  });
  const restoreCommand = `node ${JSON.stringify(path.join(target, 'scripts', 'install-global.mjs'))} --restore ${JSON.stringify(backupDir)}`;
  await writeFile(path.join(backupDir, 'RESTORE.md'), `# 恢复\n\n执行：\n\n\`\`\`text\n${restoreCommand}\n\`\`\`\n`);
  return { ...plan, applied: true, backupDir, restoreCommand };
}
