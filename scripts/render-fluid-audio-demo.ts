import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { synthesizeSfx } from '../src/client/audio/audio-composition';
import type { SfxKey } from '../src/client/audio/audio-types';

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 6;

const lowPass = (samples: Float32Array, cutoffHz: number) => {
  const output = new Float32Array(samples.length);
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
  let filtered = 0;
  for (let index = 0; index < samples.length; index += 1) {
    filtered += alpha * (samples[index] - filtered);
    output[index] = filtered;
  }
  return output;
};

const mixEvent = (
  target: Float32Array,
  key: SfxKey,
  atSeconds: number,
  seed: number,
  gain: number,
  underwater = false,
) => {
  const synthesized = synthesizeSfx(key, SAMPLE_RATE, seed);
  const samples = underwater ? lowPass(synthesized, 1_800) : synthesized;
  const offset = Math.floor(atSeconds * SAMPLE_RATE);
  for (let index = 0; index < samples.length && offset + index < target.length; index += 1)
    target[offset + index] += samples[index] * gain;
};

const encodeWave = (samples: Float32Array) => {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return buffer;
};

const output = new Float32Array(SAMPLE_RATE * DURATION_SECONDS);
mixEvent(output, 'water-enter', 0.35, 101, 1.25);
mixEvent(output, 'water-wade', 1.25, 102, 1.15);
mixEvent(output, 'water-swim', 2.15, 103, 1.25);
mixEvent(output, 'water-swim', 3.05, 104, 1.6, true);
mixEvent(output, 'water-swim', 3.75, 105, 1.6, true);
mixEvent(output, 'water-exit', 4.85, 106, 1.25);

const peak = output.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
if (peak > 0) for (let index = 0; index < output.length; index += 1) output[index] *= 0.9 / peak;

const outputPath = resolve(
  process.argv[2] ?? 'changes/2026-09-05-fluid-experience-repair/evidence/fluid-audio-demo.wav',
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, encodeWave(output));
console.info(`已导出 ${outputPath}：0.35s 入水，1.25s 涉水，2.15s 划水，3.05–4.03s 水下低通划水，4.85s 出水。`);
