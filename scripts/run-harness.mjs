// Compatibility alias. Local measurements are owned by the mesh benchmark.
if (!process.argv.includes('--owner')) process.argv.push('--owner', 'stdlib-world');
await import('./harness/local-benchmark.mjs');
