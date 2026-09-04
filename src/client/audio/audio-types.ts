export type AudioSettings = { master: number; music: number; sfx: number; ambience: number };
export type MusicPreset = 'meadow' | 'waterside' | 'night';
export type MusicContext = { biome: string; worldTime: number; waterProximity: number; danger: number };
export type MusicNote = {
  at: number;
  duration: number;
  midi: number;
  velocity: number;
  voice: 'pad' | 'bell' | 'pluck';
};
export type MusicCue = { id: string; preset: MusicPreset; duration: number; notes: MusicNote[] };
export type SurfaceSound = 'stone' | 'wood' | 'grass' | 'sand' | 'water' | 'snow';
export type SfxKey =
  | `step-${SurfaceSound}`
  | `break-${SurfaceSound}`
  | `place-${SurfaceSound}`
  | 'pickup'
  | 'damage'
  | 'confirm'
  | 'cancel'
  | 'eat'
  | 'attack'
  | 'discovery'
  | 'creature'
  | 'hover';

export const MUSIC_CUE_DURATION = 96;

export function audioRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
