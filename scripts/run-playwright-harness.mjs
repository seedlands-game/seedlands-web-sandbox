// Compatibility alias: the maintained Classic runner owns browser execution.
process.argv.push('--stage', 'classic');
await import('./harness/run.mjs');
