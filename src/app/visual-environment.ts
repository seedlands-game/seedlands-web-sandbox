import * as pc from 'playcanvas';
import { FaceMaterial, faceMaterialNames, type FaceMaterialId } from '../world/voxel';

export type QualityLevel = 'low' | 'medium' | 'high';

export type QualityProfile = {
  label: string;
  renderRadius: number;
  fogStart: number;
  fogEnd: number;
  shadowQuality: 'off' | 'low';
  resolutionScale: number;
  waterQuality: number;
  vegetationDensity: number;
};

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    label: 'Low',
    renderRadius: 1,
    fogStart: 26,
    fogEnd: 54,
    shadowQuality: 'off',
    resolutionScale: 0.72,
    waterQuality: 0.55,
    vegetationDensity: 0.62,
  },
  medium: {
    label: 'Medium',
    renderRadius: 2,
    fogStart: 48,
    fogEnd: 92,
    shadowQuality: 'off',
    resolutionScale: 0.88,
    waterQuality: 0.78,
    vegetationDensity: 0.8,
  },
  high: {
    label: 'High',
    renderRadius: 3,
    fogStart: 72,
    fogEnd: 132,
    shadowQuality: 'low',
    resolutionScale: 1,
    waterQuality: 1,
    vegetationDensity: 1,
  },
};

type Rgb = readonly [number, number, number];
type EnvironmentKeyframe = {
  hour: number;
  top: Rgb;
  horizon: Rgb;
  fog: Rgb;
  ambient: Rgb;
  sun: Rgb;
  intensity: number;
};

const ENVIRONMENT_KEYFRAMES: readonly EnvironmentKeyframe[] = [
  {
    hour: 0,
    top: [5, 11, 28],
    horizon: [18, 29, 56],
    fog: [12, 22, 42],
    ambient: [0.26, 0.29, 0.39],
    sun: [0.35, 0.45, 0.72],
    intensity: 0,
  },
  {
    hour: 5,
    top: [9, 18, 39],
    horizon: [48, 48, 72],
    fog: [31, 37, 57],
    ambient: [0.25, 0.28, 0.38],
    sun: [0.63, 0.55, 0.62],
    intensity: 0.05,
  },
  {
    hour: 6.5,
    top: [44, 78, 122],
    horizon: [244, 142, 94],
    fog: [151, 112, 104],
    ambient: [0.38, 0.34, 0.36],
    sun: [1, 0.55, 0.3],
    intensity: 0.62,
  },
  {
    hour: 9,
    top: [76, 143, 196],
    horizon: [188, 221, 221],
    fog: [151, 190, 202],
    ambient: [0.52, 0.6, 0.66],
    sun: [1, 0.91, 0.72],
    intensity: 1.18,
  },
  {
    hour: 16.5,
    top: [66, 132, 188],
    horizon: [192, 218, 210],
    fog: [145, 181, 193],
    ambient: [0.51, 0.57, 0.61],
    sun: [1, 0.88, 0.67],
    intensity: 1.08,
  },
  {
    hour: 18.5,
    top: [52, 68, 120],
    horizon: [247, 111, 69],
    fog: [150, 86, 83],
    ambient: [0.35, 0.28, 0.31],
    sun: [1, 0.42, 0.2],
    intensity: 0.56,
  },
  {
    hour: 20,
    top: [11, 20, 44],
    horizon: [69, 52, 78],
    fog: [36, 34, 53],
    ambient: [0.24, 0.27, 0.37],
    sun: [0.47, 0.48, 0.68],
    intensity: 0.03,
  },
  {
    hour: 24,
    top: [5, 11, 28],
    horizon: [18, 29, 56],
    fog: [12, 22, 42],
    ambient: [0.26, 0.29, 0.39],
    sun: [0.35, 0.45, 0.72],
    intensity: 0,
  },
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const mixRgb = (a: Rgb, b: Rgb, amount: number): Rgb => [
  mix(a[0], b[0], amount),
  mix(a[1], b[1], amount),
  mix(a[2], b[2], amount),
];
const cssRgb = ([r, g, b]: Rgb) => {
  const scale = Math.max(r, g, b) <= 1 ? 255 : 1;
  return `rgb(${Math.round(r * scale)} ${Math.round(g * scale)} ${Math.round(b * scale)})`;
};

function sampleEnvironment(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  let left = ENVIRONMENT_KEYFRAMES[0];
  let right = ENVIRONMENT_KEYFRAMES[1];
  for (let index = 1; index < ENVIRONMENT_KEYFRAMES.length; index += 1) {
    right = ENVIRONMENT_KEYFRAMES[index];
    if (normalized <= right.hour) break;
    left = right;
  }
  const amount = clamp01((normalized - left.hour) / Math.max(0.001, right.hour - left.hour));
  return {
    top: mixRgb(left.top, right.top, amount),
    horizon: mixRgb(left.horizon, right.horizon, amount),
    fog: mixRgb(left.fog, right.fog, amount),
    ambient: mixRgb(left.ambient, right.ambient, amount),
    sun: mixRgb(left.sun, right.sun, amount),
    intensity: mix(left.intensity, right.intensity, amount),
  };
}

const normalizedColor = ([r, g, b]: Rgb) => new pc.Color(r > 1 ? r / 255 : r, g > 1 ? g / 255 : g, b > 1 ? b / 255 : b);

function loadAtlas(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Voxel texture atlas could not be loaded.'));
    image.src = '/assets/voxel-atlas.webp';
  });
}

function drawMirroredTile(image: HTMLImageElement, column: number, row: number, leaves: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const sourceSize = image.naturalWidth / 3;
  for (let y = 0; y < 2; y += 1)
    for (let x = 0; x < 2; x += 1) {
      context.save();
      context.translate(x * 64 + (x ? 64 : 0), y * 64 + (y ? 64 : 0));
      context.scale(x ? -1 : 1, y ? -1 : 1);
      context.drawImage(image, column * sourceSize, row * sourceSize, sourceSize, sourceSize, 0, 0, 64, 64);
      context.restore();
    }
  if (leaves) {
    const pixels = context.getImageData(0, 0, 128, 128);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const brightness = (pixels.data[index] + pixels.data[index + 1] * 1.5 + pixels.data[index + 2]) / 3.5;
      pixels.data[index + 3] = brightness < 35 ? 0 : Math.min(255, Math.round((brightness - 35) * 10));
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function waterCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 64, 64);
  gradient.addColorStop(0, '#2d9ab2');
  gradient.addColorStop(0.5, '#176f96');
  gradient.addColorStop(1, '#2d9ab2');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  context.globalAlpha = 0.25;
  context.strokeStyle = '#b9f2e8';
  context.lineWidth = 2;
  for (let band = -1; band <= 4; band += 1) {
    context.beginPath();
    for (let x = 0; x <= 64; x += 4) {
      const y = band * 18 + Math.sin((x / 64) * Math.PI * 2) * 3;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  return canvas;
}

function textureFromCanvas(device: pc.GraphicsDevice, name: string, canvas: HTMLCanvasElement) {
  const texture = new pc.Texture(device, {
    name,
    width: canvas.width,
    height: canvas.height,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: 4,
    srgb: true,
  });
  texture.setSource(canvas);
  return texture;
}

export type VoxelMaterials = {
  materials: Map<number, pc.StandardMaterial>;
  water: pc.StandardMaterial;
  destroy: () => void;
};

export async function createVoxelMaterials(app: pc.Application, quality: QualityProfile): Promise<VoxelMaterials> {
  const image = await loadAtlas();
  const tiles = new Map<FaceMaterialId, pc.Texture>();
  const atlasPositions: Record<number, readonly [number, number]> = {
    [FaceMaterial.GrassTop]: [0, 0],
    [FaceMaterial.GrassSide]: [1, 0],
    [FaceMaterial.Dirt]: [2, 0],
    [FaceMaterial.Stone]: [0, 1],
    [FaceMaterial.Sand]: [1, 1],
    [FaceMaterial.WoodSide]: [2, 1],
    [FaceMaterial.WoodEnd]: [0, 2],
    [FaceMaterial.Leaves]: [1, 2],
    [FaceMaterial.Snow]: [2, 2],
  };
  for (const [rawMaterial, [column, row]] of Object.entries(atlasPositions)) {
    const material = Number(rawMaterial) as FaceMaterialId;
    tiles.set(
      material,
      textureFromCanvas(
        app.graphicsDevice,
        faceMaterialNames[material],
        drawMirroredTile(image, column, row, material === FaceMaterial.Leaves),
      ),
    );
  }
  tiles.set(FaceMaterial.Water, textureFromCanvas(app.graphicsDevice, 'water', waterCanvas()));

  const materials = new Map<number, pc.StandardMaterial>();
  for (const [id, texture] of tiles) {
    const material = new pc.StandardMaterial();
    material.name = faceMaterialNames[id];
    material.diffuse = pc.Color.WHITE;
    material.ambient = pc.Color.WHITE;
    material.diffuseMap = texture;
    material.diffuseVertexColor = true;
    material.gloss = id === FaceMaterial.Water ? 0.82 : 0.08;
    if (id === FaceMaterial.Leaves) {
      material.opacityMap = texture;
      material.opacityMapChannel = 'a';
      material.alphaTest = mix(0.36, 0.12, quality.vegetationDensity);
      material.twoSidedLighting = true;
    }
    if (id === FaceMaterial.Water) {
      material.diffuse = new pc.Color(0.52, 0.88, 0.94);
      material.emissive = new pc.Color(0.02, 0.11, 0.15);
      material.opacity = mix(0.5, 0.68, quality.waterQuality);
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
      material.opacityFadesSpecular = false;
    }
    material.update();
    materials.set(id, material);
  }
  return {
    materials,
    water: materials.get(FaceMaterial.Water)!,
    destroy: () => {
      materials.forEach((material) => material.destroy());
      tiles.forEach((texture) => texture.destroy());
    },
  };
}

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
