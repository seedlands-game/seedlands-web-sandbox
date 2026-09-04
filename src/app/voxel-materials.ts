import * as pc from 'playcanvas';
import { publicAssetUrl } from '../client/public-asset-url';
import { FaceMaterial, faceMaterialNames, type FaceMaterialId } from '../world/voxel';
import type { QualityProfile } from './quality-profile';

const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

function loadAtlas(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Voxel texture atlas could not be loaded.'));
    image.src = publicAssetUrl(import.meta.env.BASE_URL, 'assets/voxel-atlas.webp');
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
