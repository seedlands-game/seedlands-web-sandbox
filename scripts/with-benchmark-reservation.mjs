import { mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadavg, freemem, totalmem } from 'node:os';
const directory = '/tmp/seedlands-benchmark-reservation';
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Expected command and arguments.');
const owner = {
  ownerThread: '01a076cb-d2b7-7d63-8446-f42332d6c5a8',
  runId: process.env.SEEDLANDS_RESERVATION_RUN ?? randomUUID(),
  pid: process.pid,
  startedAt: new Date().toISOString(),
};
try {
  mkdirSync(directory);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  process.stderr.write('Benchmark reservation is already owned; refusing concurrent CPU work.\n');
  process.exit(75);
}
writeFileSync(`${directory}/owner.json`, JSON.stringify(owner, null, 2));
const samples = [];
const sample = () =>
  samples.push({
    at: new Date().toISOString(),
    loadAverage: loadavg(),
    freeMemoryBytes: freemem(),
    totalMemoryBytes: totalmem(),
  });
sample();
const timer = setInterval(sample, 5000);
const child = spawn(command, args, { stdio: 'inherit', env: process.env });
const release = (code) => {
  clearInterval(timer);
  sample();
  if (process.env.SEEDLANDS_RESERVATION_EVIDENCE)
    writeFileSync(
      process.env.SEEDLANDS_RESERVATION_EVIDENCE,
      JSON.stringify({ ...owner, endedAt: new Date().toISOString(), exitCode: code, samples }, null, 2) + '\n',
    );
  const current = JSON.parse(readFileSync(`${directory}/owner.json`, 'utf8'));
  if (current.pid === owner.pid && current.runId === owner.runId) {
    unlinkSync(`${directory}/owner.json`);
    rmdirSync(directory);
  }
  process.exitCode = code;
};
child.once('error', (error) => {
  process.stderr.write(String(error) + '\n');
  release(1);
});
child.once('exit', (code, signal) => release(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
