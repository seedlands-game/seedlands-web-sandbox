#!/usr/bin/env node
import { loadAndValidateContract, renderHandoff, reportTemplate } from './lib/contract.mjs';
import { runSafeCli } from './lib/safe-cli.mjs';

await runSafeCli(
  async () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.length === 0) {
      console.log('用法: render-handoff.mjs <contract.json> [--expected-hash <sha256>] [--report]');
      process.exitCode = args.length === 0 ? 1 : 0;
      return;
    }
    const hashIndex = args.indexOf('--expected-hash');
    const loaded = await loadAndValidateContract(args[0], {
      expectedHash: hashIndex >= 0 ? args[hashIndex + 1] : undefined,
    });
    console.log(args.includes('--report') ? reportTemplate(loaded.contract) : renderHandoff(loaded));
  },
  {
    code: 'HANDOFF_RENDER_FAILED',
    stage: 'render',
  },
);
