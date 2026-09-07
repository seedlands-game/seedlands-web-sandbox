export async function runSafeCli(main, { code, stage }) {
  try {
    await main();
  } catch {
    process.stderr.write(`${JSON.stringify({ ok: false, code, stage })}\n`);
    process.exitCode = 1;
  }
}
