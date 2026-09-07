import { spawn } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';

const [events, durationText, exitText, pidFile] = process.argv.slice(2);
const duration = Number(durationText);
await appendFile(events, `${JSON.stringify({ label: 'start', duration, at: Date.now() })}\n`);
if (pidFile) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await writeFile(pidFile, String(child.pid));
  child.unref();
}
await new Promise((resolve) => setTimeout(resolve, duration));
await appendFile(events, `${JSON.stringify({ label: 'end', duration, at: Date.now() })}\n`);
process.exitCode = Number(exitText);
