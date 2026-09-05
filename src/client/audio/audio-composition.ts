import { audioRandom, MUSIC_CUE_DURATION, type MusicCue, type MusicPreset, type SfxKey } from './audio-types';

/** Original modal phrases: the score is data, independent of audio device and frame rate. */
export function composeMusicCue(preset: MusicPreset, seed: number): MusicCue {
  const random = audioRandom(seed);
  const roots = preset === 'night' ? [45, 48, 43, 45] : preset === 'waterside' ? [50, 48, 45, 43] : [48, 43, 45, 41];
  const offsets = preset === 'night' ? [0, 7, 10, 14, 19] : [0, 4, 7, 9, 14];
  const cue: MusicCue = { id: `${preset}-${seed >>> 0}`, preset, duration: MUSIC_CUE_DURATION, notes: [] };
  for (let phrase = 0; phrase < 4; phrase++) {
    const root = roots[phrase];
    const at = phrase * 23 + 1;
    for (const interval of [0, 7, 14]) {
      cue.notes.push({ voice: 'pad', at, duration: 17, midi: root + interval, velocity: 0.13 });
    }
    const phraseNotes = preset === 'night' ? 4 : 6;
    for (let index = 0; index < phraseNotes; index++) {
      const offset = offsets[Math.floor(random() * offsets.length)];
      const onset = at + 2.5 + index * (preset === 'night' ? 3.8 : 2.8) + random() * 0.7;
      cue.notes.push({
        voice: index % 3 === 0 ? 'bell' : 'pluck',
        at: onset,
        duration: index % 3 === 0 ? 3.2 : 1.8,
        midi: root + 12 + offset,
        velocity: 0.16 + random() * 0.13,
      });
    }
  }
  cue.notes.sort((a, b) => a.at - b.at);
  return cue;
}

const hashKey = (key: string) => {
  let hash = 0;
  for (const character of key) hash = Math.imul(hash, 31) + character.charCodeAt(0);
  return hash;
};

export function synthesizeSfx(key: SfxKey, sampleRate: number, seed: number) {
  const random = audioRandom(seed ^ hashKey(key));
  const creature = key === 'creature';
  const waterMovement = key.startsWith('water-');
  const chime = ['pickup', 'confirm', 'hover', 'discovery'].includes(key);
  const damage = key === 'damage' || key === 'attack';
  const material = key.split('-')[1] ?? 'grass';
  const pitch = waterMovement
    ? key === 'water-enter'
      ? 92
      : key === 'water-exit'
        ? 128
        : 74
    : creature
      ? 220
      : chime
        ? key === 'hover'
          ? 620
          : 880
        : damage
          ? 95
          : material === 'stone'
            ? 460
            : material === 'wood'
              ? 170
              : 110;
  const duration = waterMovement
    ? key === 'water-enter' || key === 'water-exit'
      ? 0.44
      : 0.28
    : creature
      ? 0.7
      : key === 'discovery'
        ? 1.6
        : chime
          ? 0.38
          : key.startsWith('break')
            ? 0.28
            : damage
              ? 0.26
              : 0.16;
  const count = Math.max(2, Math.ceil(sampleRate * duration));
  const samples = new Float32Array(count);
  let noiseState = 0;
  for (let i = 0; i < count; i++) {
    const time = i / sampleRate;
    const progress = i / (count - 1);
    const attack = Math.min(1, time / (creature ? 0.04 : chime ? 0.012 : 0.004));
    const envelope = attack * Math.exp(-(chime ? 3 : 5) * progress) * Math.min(1, (1 - progress) * 12);
    const noise = random() * 2 - 1;
    noiseState += (material === 'sand' || material === 'grass' ? 0.55 : 0.2) * (noise - noiseState);
    const sweep = damage ? pitch * (time - time * time * 1.3) : pitch * time;
    const fundamental = Math.sin(2 * Math.PI * sweep);
    const overtone = Math.sin(2 * Math.PI * pitch * (chime ? 2.502 : 2.37) * time) * Math.exp(-time * 16);
    const tone = fundamental * (chime ? 0.65 : 0.23) + overtone * (chime ? 0.24 : 0.1);
    const callTone =
      Math.sin(2 * Math.PI * pitch * time + 1.3 * Math.sin(2 * Math.PI * 4 * time)) * 0.45 +
      Math.sin(Math.PI * pitch * time) * 0.2;
    const waterTone = Math.sin(2 * Math.PI * (pitch + 28 * Math.sin(time * 11)) * time) * 0.08;
    samples[i] =
      ((waterMovement ? waterTone : creature ? callTone : tone) +
        noiseState * (waterMovement ? 0.82 : creature ? 0.04 : chime ? 0.008 : 0.65)) *
      envelope *
      (damage ? 0.7 : 0.48);
  }
  return samples;
}
