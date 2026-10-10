import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePackLightingProfile } from '../../../src/client/presentation/pack-lighting-profile';
import { sampleLightingFrame } from '../../../src/app/scene/lighting-frame';

const profile = (path: string) => parsePackLightingProfile(JSON.parse(readFileSync(path, 'utf8')).lighting);
describe('Pack-owned linear environment frame', () => {
  it('interpolates declared sky energy and preserves the cyclic midnight boundary', () => {
    const classic = profile('playbooks/classic/presentation.json');
    const left = classic.environmentKeyframes[0]!;
    const right = classic.environmentKeyframes[1]!;
    const frame = sampleLightingFrame(classic, (left.hour + right.hour) / 2);
    expect(frame.skyRadiance).toEqual(left.skyRadiance.map((value, index) => (value + right.skyRadiance[index]!) / 2));
    expect(sampleLightingFrame(classic, 24)).toEqual(sampleLightingFrame(classic, 0));
    expect(sampleLightingFrame(classic, -24)).toEqual(sampleLightingFrame(classic, 0));
  });
  it('uses the selected Pack profile rather than treating Modular as Classic', () => {
    const classic = profile('playbooks/classic/presentation.json');
    const modular = profile('apps/web/tests/fixtures/packs/modular-world/presentation.json');
    expect(sampleLightingFrame(classic, 12).skyRadiance).not.toEqual(sampleLightingFrame(modular, 12).skyRadiance);
    expect(sampleLightingFrame(modular, 12).blockLightTint).toEqual(modular.blockLightTint);
  });
  it('legacy absence stays explicit and non-finite time is rejected', () => {
    expect(sampleLightingFrame(undefined, 12).skyRadiance.every(Number.isFinite)).toBe(true);
    expect(() => sampleLightingFrame(undefined, Number.NaN)).toThrow();
  });
});
