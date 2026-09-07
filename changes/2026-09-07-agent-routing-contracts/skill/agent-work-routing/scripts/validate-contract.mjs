#!/usr/bin/env node
import { loadAndValidateContract } from './lib/contract.mjs';
import { runSafeCli } from './lib/safe-cli.mjs';

await runSafeCli(
  async () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.length === 0) {
      console.log('用法: validate-contract.mjs <contract.json> [--expected-hash <sha256>]');
      process.exitCode = args.length === 0 ? 1 : 0;
      return;
    }
    const hashIndex = args.indexOf('--expected-hash');
    const loaded = await loadAndValidateContract(args[0], {
      expectedHash: hashIndex >= 0 ? args[hashIndex + 1] : undefined,
    });
    console.log(JSON.stringify({ valid: true, id: loaded.contract.id, sha256: loaded.sha256 }));
  },
  {
    code: 'CONTRACT_VALIDATION_FAILED',
    stage: 'validate',
  },
);
