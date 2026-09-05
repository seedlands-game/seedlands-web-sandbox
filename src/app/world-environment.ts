import * as pc from 'playcanvas';
import { cssRgb, sampleEnvironment, type Rgb } from './environment-palette';
import type { QualityProfile } from './quality-profile';
import { celestialDirection, SkySun } from './sky-sun';

const normalizedColor = ([r, g, b]: Rgb) => new pc.Color(r > 1 ? r / 255 : r, g > 1 ? g / 255 : g, b > 1 ? b / 255 : b);
const UNDERWATER_FOG = new pc.Color(0.035, 0.22, 0.29, 1);

export class WorldEnvironment {
  worldTime = 9.5;
  paused = false;
  speed = 1;
  private elapsed = 0;
  private readonly skySun: SkySun;
  private underwaterBlend = 0;
  private waterFlow: readonly [number, number] = [0.92, 0.39];

  constructor(
    private readonly app: pc.Application,
    private readonly sun: pc.Entity,
    private readonly quality: QualityProfile,
    private readonly water: readonly pc.StandardMaterial[],
  ) {
    app.scene.fog.type = pc.FOG_LINEAR;
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2) * quality.resolutionScale;
    this.skySun = new SkySun(app);
    this.apply();
  }

  update(dt: number, worldTime = this.worldTime) {
    this.elapsed += dt;
    this.worldTime = ((worldTime % 24) + 24) % 24;
    const waterOffset = (this.elapsed * 0.026 * this.quality.waterQuality) % 1;
    this.water.forEach((material) =>
      material.diffuseMapOffset.set(waterOffset * this.waterFlow[0], waterOffset * this.waterFlow[1]),
    );
    this.apply();
  }

  setTime(hour: number) {
    this.worldTime = ((hour % 24) + 24) % 24;
    this.apply();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  setUnderwaterBlend(amount: number) {
    this.underwaterBlend = Math.max(0, Math.min(1, amount));
    this.apply();
  }

  setWaterFlowDirection(direction: readonly [number, number] | null) {
    const length = direction ? Math.hypot(direction[0], direction[1]) : 0;
    if (direction && length > 0.001) this.waterFlow = [direction[0] / length, direction[1] / length];
  }

  destroy() {
    this.skySun.destroy();
  }

  cycleSpeed() {
    this.speed = this.speed === 1 ? 20 : this.speed === 20 ? 100 : 1;
  }

  sunSnapshot(camera: pc.Entity) {
    return this.skySun.snapshot(camera);
  }

  get phase() {
    const hour = this.worldTime;
    if (hour < 5.5 || hour >= 20) return 'Night';
    if (hour < 8) return 'Dawn';
    if (hour < 17.5) return 'Day';
    return 'Sunset';
  }

  private apply() {
    const state = sampleEnvironment(this.worldTime);
    const sunAngle = ((this.worldTime - 6) / 24) * Math.PI * 2;
    const elevation = Math.sin(sunAngle);
    const azimuth = (this.worldTime / 24) * 360 - 35;
    this.sun.setEulerAngles(90 - (Math.asin(Math.max(-1, Math.min(1, elevation))) * 180) / Math.PI, azimuth, 0);
    if (this.sun.light) {
      this.sun.light.intensity = state.intensity;
      this.sun.light.color = normalizedColor(state.sun);
    }
    this.app.scene.ambientLight = normalizedColor(state.ambient);
    this.app.scene.fog.color.lerp(normalizedColor(state.fog), UNDERWATER_FOG, this.underwaterBlend);
    this.app.scene.fog.start = this.quality.fogStart + (0.35 - this.quality.fogStart) * this.underwaterBlend;
    this.app.scene.fog.end = this.quality.fogEnd + (17 - this.quality.fogEnd) * this.underwaterBlend;
    document.documentElement.style.setProperty('--sky-top', cssRgb(state.top));
    document.documentElement.style.setProperty('--sky-horizon', cssRgb(state.horizon));
    document.documentElement.style.setProperty('--sky-glow', cssRgb(state.sun));
    const camera = this.app.root.findByName('Player');
    if (camera instanceof pc.Entity)
      this.skySun.update(camera, celestialDirection(this.worldTime), normalizedColor(state.sun));
  }
}
