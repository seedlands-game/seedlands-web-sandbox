import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = resolve(process.argv[2]);
const { runs } = JSON.parse(readFileSync(resolve(directory, 'summary.json'), 'utf8'));
const identities = new Map();
const windows = [];
let common;
for (const run of runs) {
  assert.equal(run.valid, true, `${run.name}: invalid evidence`);
  const identityKey = /-b[12]$/.test(run.name) ? run.name.split('-').at(-2) : 'control';
  const identity = JSON.stringify(run.identity);
  if (identities.has(identityKey)) assert.equal(identity, identities.get(identityKey), `${identityKey} identity drift`);
  else identities.set(identityKey, identity);
  const contract = JSON.stringify({
    scenario: run.scenario,
    environment: run.environment,
    lock: run.identity.lockDigest,
  });
  if (common) assert.equal(contract, common, `${run.name}: environment/contract drift`);
  else common = contract;
  const receipt = JSON.parse(readFileSync(resolve(directory, run.name, 'window.json'), 'utf8'));
  const classic = JSON.parse(readFileSync(resolve(directory, run.name, 'classic.json'), 'utf8'));
  const measurement = classic.attempts[0].benchmark.measurement;
  const lockedAt = Date.parse(receipt.samples[0].at);
  const endedAt = Date.parse(receipt.endedAt);
  assert.ok(lockedAt <= Date.parse(measurement.sampleStartedAt), `${run.name}: sampling before lock`);
  assert.ok(endedAt >= Date.parse(measurement.sampleCompletedAt), `${run.name}: sampling after release`);
  windows.push({ name: run.name, lockedAt, endedAt, windowId: receipt.windowId });
}
windows.sort((a, b) => a.lockedAt - b.lockedAt);
for (let index = 1; index < windows.length; index += 1)
  assert.ok(windows[index].lockedAt >= windows[index - 1].endedAt, 'Overlapping benchmark windows');
writeFileSync(
  resolve(directory, 'identity-audit.json'),
  JSON.stringify(
    { status: 'PASS', identities: Object.fromEntries(identities), runCount: runs.length, windows },
    null,
    2,
  ),
);
console.log(`PASS: ${runs.length} samples, ${identities.size} frozen variants`);
