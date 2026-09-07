#!/usr/bin/env node
import { installGlobal, restoreGlobal } from './lib/install-global.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    '用法: install-global.mjs [--codex-home <dir>] [--apply]\n      install-global.mjs --restore <backup-dir>',
  );
  process.exit(0);
}
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const restore = value('--restore');
const result = restore
  ? await restoreGlobal({ backupDir: restore })
  : await installGlobal({ codexHome: value('--codex-home'), apply: args.includes('--apply') });
console.log(JSON.stringify(result, null, 2));
