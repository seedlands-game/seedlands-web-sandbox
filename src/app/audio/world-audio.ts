import type * as pc from 'playcanvas';
import { Voxel } from '../../world/voxel';
import { macroAt } from '../../world/macro-world';
import type { World } from '../world-runtime';
import { FootstepTracker, MusicCueScheduler } from '../../client/audio/audio-policy';
import { audioRandom, type MusicContext, type SfxKey, type SurfaceSound } from '../../client/audio/audio-types';
import type { GlobalAudio } from './global-audio';

export function surfaceSound(voxel: number): SurfaceSound {
  if (voxel === Voxel.Wood || voxel === Voxel.Leaves) return 'wood';
  if (voxel === Voxel.Grass || voxel === Voxel.Dirt) return 'grass';
  if (voxel === Voxel.Sand) return 'sand';
  if (voxel === Voxel.Water) return 'water';
  if (voxel === Voxel.Snow) return 'snow';
  return 'stone';
}

export class WorldAudio {
  private readonly session: string;
  private readonly steps = new FootstepTracker();
  private readonly scheduler: MusicCueScheduler;
  private readonly loops: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private disposed = false;
  private nextContextAt = 0;
  private paused = false;

  constructor(
    private readonly audio: GlobalAudio,
    seed: number,
  ) {
    this.session = audio.beginWorld();
    this.scheduler = new MusicCueScheduler(seed);
    this.createAmbience(seed);
  }

  updateWorld(camera: pc.Entity, world: World, grounded: boolean, paused: boolean) {
    const { x, y, z } = camera.getPosition();
    this.update(
      camera,
      grounded,
      world.getVoxel(Math.floor(x), Math.floor(y - 1.7), Math.floor(z)),
      () => {
        const macro = macroAt(world.seed, x, z);
        return {
          biome: macro.biome,
          worldTime: world.server.worldTime,
          waterProximity: macro.hydrology.water ? 1 : 0,
          danger: 0,
        };
      },
      paused,
    );
  }

  update(camera: pc.Entity, grounded: boolean, surface: number, getContext: () => MusicContext, paused: boolean) {
    if (this.disposed) return;
    const graph = this.audio.graph;
    if (!graph) return;
    graph.manager.listener.setPosition(camera.getPosition());
    graph.manager.listener.setOrientation(camera.getWorldTransform());
    this.paused = paused || document.hidden;
    const position = camera.getPosition();
    const count = this.steps.sample([position.x, position.y, position.z], grounded && !this.paused);
    if (!this.paused && count) this.play(`step-${surfaceSound(surface)}`, undefined, 0);
    const now = graph.context.currentTime;
    if (now < this.nextContextAt && !this.paused) return;
    this.nextContextAt = now + 0.5;
    const context = getContext();
    for (const action of this.scheduler.update(context, now, this.paused)) {
      if (action.type === 'start') this.audio.music?.start(action.preset, action.seed);
      else this.audio.music?.stop();
    }
    const wind = this.paused ? 0 : 0.1;
    const water = this.paused ? 0 : Math.min(0.25, context.waterProximity * 0.25);
    this.loops[0]?.gain.gain.setTargetAtTime(wind, now, 0.8);
    this.loops[1]?.gain.gain.setTargetAtTime(water, now, 0.8);
  }

  play(key: SfxKey, position?: readonly [number, number, number], priority = 1, target?: string) {
    if (this.disposed || this.paused) return false;
    return this.audio.play(key, { session: this.session, position, priority, target });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { source, gain } of this.loops) {
      source.stop();
      source.disconnect();
      gain.disconnect();
    }
    this.loops.length = 0;
    this.audio.endWorld();
  }

  private createAmbience(seed: number) {
    const graph = this.audio.graph;
    if (!graph) return;
    const context = graph.context;
    const random = audioRandom(seed);
    for (const smoothing of [0.004, 0.12]) {
      const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
      const data = buffer.getChannelData(0);
      let filtered = 0;
      for (let i = 0; i < data.length; i++) {
        filtered += (random() * 2 - 1 - filtered) * smoothing;
        const edge = Math.min(1, i / 1200, (data.length - i - 1) / 1200);
        data[i] = filtered * edge;
      }
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(graph.ambience);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      this.loops.push({ source, gain });
    }
  }
}
