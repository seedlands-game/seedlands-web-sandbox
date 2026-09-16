// Compatibility alias: the maintained Classic runner owns browser execution.
process.argv.push('--stage', 'runtime');
await import('./harness/run.mjs');
