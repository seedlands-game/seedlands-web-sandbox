import { describe, expect, it } from 'vitest';
import { composeMusicCue, synthesizeSfx } from '../../src/client/audio/audio-composition';

describe('原创电子声音素材', () => {
  it('三首可重建乐谱有完整时长、两层以上音色、稀疏音符和有界音域', () => {
    for (const preset of ['meadow', 'waterside', 'night'] as const) {
      const cue = composeMusicCue(preset, 42);
      expect(cue).toEqual(composeMusicCue(preset, 42));
      expect(cue.duration).toBeGreaterThanOrEqual(90);
      expect(cue.duration).toBeLessThanOrEqual(120);
      expect(cue.notes.length).toBeGreaterThan(12);
      expect(cue.notes.length).toBeLessThan(120);
      expect(new Set(cue.notes.map((note) => note.voice)).size).toBeGreaterThanOrEqual(2);
      for (const note of cue.notes) {
        expect(note.at).toBeGreaterThanOrEqual(0);
        expect(note.at + note.duration).toBeLessThanOrEqual(cue.duration);
        expect(note.midi).toBeGreaterThanOrEqual(36);
        expect(note.midi).toBeLessThanOrEqual(88);
        expect(note.velocity).toBeGreaterThan(0);
        expect(note.velocity).toBeLessThanOrEqual(0.5);
      }
    }
    expect(composeMusicCue('meadow', 42)).not.toEqual(composeMusicCue('night', 42));
    expect(composeMusicCue('meadow', 42).notes).not.toEqual(composeMusicCue('meadow', 43).notes);
  });

  it('合成 SFX 波形确定、非静音、无削顶且首尾平滑，不同材质音色有差异', () => {
    for (const key of [
      'step-stone',
      'step-grass',
      'break-wood',
      'place-stone',
      'pickup',
      'damage',
      'confirm',
      'cancel',
      'creature',
    ] as const) {
      const samples = synthesizeSfx(key, 22050, 17);
      expect(samples).toEqual(synthesizeSfx(key, 22050, 17));
      let energy = 0;
      let peak = 0;
      for (const value of samples) {
        expect(Number.isFinite(value)).toBe(true);
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
      expect(peak).toBeLessThan(0.95);
      expect(energy / samples.length).toBeGreaterThan(0.00001);
      expect(Math.abs(samples[0])).toBeLessThan(0.001);
      expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.001);
    }
    expect(synthesizeSfx('creature', 22050, 17).length).toBeGreaterThanOrEqual(22050 * 0.5);
    expect(synthesizeSfx('step-stone', 22050, 17)).not.toEqual(synthesizeSfx('step-grass', 22050, 17));
  });
});
