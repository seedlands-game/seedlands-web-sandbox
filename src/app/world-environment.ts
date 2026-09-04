import * as pc from 'playcanvas';
import { clamp01, cssRgb, sampleEnvironment, type Rgb } from './environment-palette';
import type { QualityProfile } from './quality-profile';

const normalizedColor = ([r, g, b]: Rgb) => new pc.Color(r > 1 ? r / 255 : r, g > 1 ? g / 255 : g, b > 1 ? b / 255 : b);

export class WorldEnvironment {
  worldTime = 9.5;
  paused = false;
  speed = 1;
  private elapsed = 0;

  constructor(
    private readonly app: pc.Application,
    private readonly sun: pc.Entity,
    private readonly quality: QualityProfile,
    private readonly water: pc.StandardMaterial,
  ) {
    app.scene.fog.type = pc.FOG_LINEAR;
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2) * quality.resolutionScale;
    this.apply();
  }

  update(dt: number, worldTime = this.worldTime) {
    this.elapsed += dt;
    this.worldTime = ((worldTime % 24) + 24) % 24;
    const waterOffset = (this.elapsed * 0.018 * this.quality.waterQuality) % 1;
    this.water.diffuseMapOffset.set(waterOffset, waterOffset * 0.42);
    this.apply();
  }

  setTime(hour: number) {
    this.worldTime = ((hour % 24) + 24) % 24;
    this.apply();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  cycleSpeed() {
    this.speed = this.speed === 1 ? 20 : this.speed === 20 ? 100 : 1;
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
    this.app.scene.fog.color.copy(normalizedColor(state.fog));
    this.app.scene.fog.start = this.quality.fogStart;
    this.app.scene.fog.end = this.quality.fogEnd;
    document.documentElement.style.setProperty('--sky-top', cssRgb(state.top));
    document.documentElement.style.setProperty('--sky-horizon', cssRgb(state.horizon));
    document.documentElement.style.setProperty('--sky-glow', cssRgb(state.sun));
    document.documentElement.style.setProperty('--sun-x', `${clamp01(0.5 + Math.cos(sunAngle) * 0.42) * 100}%`);
    document.documentElement.style.setProperty('--sun-y', `${clamp01(0.72 - elevation * 0.54) * 100}%`);
  }
}
