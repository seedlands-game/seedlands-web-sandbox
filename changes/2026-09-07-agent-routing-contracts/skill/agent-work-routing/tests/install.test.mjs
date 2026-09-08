import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installGlobal } from '../scripts/lib/install-global.mjs';

test('安装器默认 dry-run；apply 备份、幂等注入、hash 清单与恢复说明完整', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'routing-install-'));
  const target = path.join(codexHome, 'skills', 'agent-work-routing');
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'old.txt'), 'old skill\n');
  await writeFile(path.join(codexHome, 'AGENTS.md'), '原有规则保持原样\n');
  const dry = await installGlobal({ codexHome, apply: false });
  assert.equal(dry.applied, false);
  assert.equal(await readFile(path.join(target, 'old.txt'), 'utf8'), 'old skill\n');

  const applied = await installGlobal({ codexHome, apply: true });
  assert.equal(applied.applied, true);
  const agents = await readFile(path.join(codexHome, 'AGENTS.md'), 'utf8');
  assert.match(agents, /^原有规则保持原样\n/);
  assert.equal(agents.match(/agent-work-routing:start/g)?.length, 1);
  await access(path.join(applied.backupDir, 'skill-original', 'old.txt'));
  await access(path.join(applied.backupDir, 'installed-hashes.json'));
  await access(path.join(applied.backupDir, 'RESTORE.md'));

  await installGlobal({ codexHome, apply: true });
  const agentsAgain = await readFile(path.join(codexHome, 'AGENTS.md'), 'utf8');
  assert.equal(agentsAgain.match(/agent-work-routing:start/g)?.length, 1);
  assert.match(agentsAgain, /^原有规则保持原样\n/);
});
