export type ViewmodelLayout = Readonly<{
  normalizedAnchorX: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  scale: number;
}>;

export function resolveViewmodelLayout({
  width,
  height,
  fov,
}: Readonly<{ width: number; height: number; fov: number }>): ViewmodelLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const aspect = safeWidth / safeHeight;
  const verticalTangent = Math.tan((Math.max(35, Math.min(100, fov)) * Math.PI) / 360);
  const normalizedAnchorX = aspect < 1 ? 0.5 : aspect > 2 ? 0.36 : 0.38;
  const z = -1.5;
  return {
    normalizedAnchorX,
    position: {
      x: normalizedAnchorX * aspect * verticalTangent * Math.abs(z),
      y: aspect < 1 ? -0.4 : -0.48,
      z,
    },
    scale: aspect > 2 ? 0.62 : aspect < 1 ? 0.6 : 0.66,
  };
}
