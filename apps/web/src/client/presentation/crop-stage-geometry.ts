type Position = readonly [number, number, number];
type Input = Readonly<{ positions: readonly Position[]; origin: Position; height: number; width: number }>;

/** Detached chunk-local crossed quads; no voxel, collision or authority mutation. */
export function buildCropStageGeometry(input: Input) {
  const { height, width, origin } = input;
  if (
    ![height, width].every((value) => Number.isFinite(value) && value > 0 && value <= 2) ||
    origin.length !== 3 ||
    !origin.every(Number.isSafeInteger)
  )
    throw new TypeError('Crop stage geometry dimensions are invalid.');
  const positions = new Float32Array(input.positions.length * 24);
  const normals = new Float32Array(input.positions.length * 24);
  const uvs = new Float32Array(input.positions.length * 16);
  const indices = new Uint32Array(input.positions.length * 12);
  const half = width / 2;
  input.positions.forEach((position, index) => {
    if (position.length !== 3 || !position.every(Number.isSafeInteger))
      throw new TypeError('Crop stage geometry position is invalid.');
    const x = position[0] + 0.5 - origin[0],
      y = position[1] + 1 - origin[1],
      z = position[2] + 0.5 - origin[2];
    for (let plane = 0; plane < 2; plane += 1) {
      const direction = plane === 0 ? 1 : -1;
      const vertices = [
        x - half,
        y,
        z - half * direction,
        x + half,
        y,
        z + half * direction,
        x + half,
        y + height,
        z + half * direction,
        x - half,
        y + height,
        z - half * direction,
      ];
      const vertex = index * 8 + plane * 4;
      positions.set(vertices, vertex * 3);
      for (let corner = 0; corner < 4; corner += 1)
        normals.set([-direction * Math.SQRT1_2, 0, Math.SQRT1_2], (vertex + corner) * 3);
      uvs.set([0, 1, 1, 1, 1, 0, 0, 0], vertex * 2);
      indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], index * 12 + plane * 6);
    }
  });
  return { positions, normals, uvs, indices };
}
