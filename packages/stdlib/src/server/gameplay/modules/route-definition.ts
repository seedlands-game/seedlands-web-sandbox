const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const SIDES = ['north', 'east', 'south', 'west'] as const;
const MAX_VARIANTS = 64;
const MAX_TIE_BREAKS = 64;

export type RouteSideV1 = (typeof SIDES)[number];
export type RouteEndpointV1 = Readonly<{ side: RouteSideV1; elevation: -1 | 0 | 1 }>;
export type RouteCurveV1 = 'line' | 'quarter';

export type RouteDirectedEdgeV1 = Readonly<{
  entry: RouteEndpointV1;
  exit: RouteEndpointV1;
  curve: RouteCurveV1;
  slopeDelta: -1 | 0 | 1;
}>;

export type RouteVariantDefinitionV1 = Readonly<{
  variant: string;
  edges: readonly RouteDirectedEdgeV1[];
}>;

export type RoutePlacementTieBreakV1 = Readonly<{
  connected: readonly RouteEndpointV1[];
  variant: string;
}>;

export type RouteDefinitionV1 = Readonly<{
  version: 1;
  family: string;
  variants: readonly RouteVariantDefinitionV1[];
  placementTieBreaks: readonly RoutePlacementTieBreakV1[];
}>;

export type RouteNeighborStateV1 = 'connected' | 'disconnected' | 'unknown';
export type RouteNeighborV1 = Readonly<{ endpoint: RouteEndpointV1; state: RouteNeighborStateV1 }>;

export type RouteSegmentV1 = Readonly<{
  family: string;
  variant: string;
  edge: RouteDirectedEdgeV1;
  length: number;
}>;

export type RouteResolutionV1 =
  | Readonly<{ status: 'segment'; segment: RouteSegmentV1 }>
  | Readonly<{ status: 'unknown'; endpoints: readonly RouteEndpointV1[] }>
  | Readonly<{ status: 'disconnected' }>
  | Readonly<{ status: 'ambiguous'; variants: readonly string[] }>;

export type RouteProgressV1 = Readonly<{
  progress: number;
  overshoot: number;
  position: readonly [number, number, number];
  tangent: readonly [number, number, number];
}>;

export type RouteDefinitionInputV1 = Readonly<{
  version: 1;
  family: string;
  variants: readonly RouteVariantDefinitionV1[];
  placementTieBreaks?: readonly RoutePlacementTieBreakV1[];
}>;

const sideIndex = (side: RouteSideV1): number => SIDES.indexOf(side);
const opposite = (left: RouteSideV1, right: RouteSideV1): boolean => Math.abs(sideIndex(left) - sideIndex(right)) === 2;
const adjacent = (left: RouteSideV1, right: RouteSideV1): boolean => left !== right && !opposite(left, right);

const endpointKey = (endpoint: RouteEndpointV1): string => `${endpoint.side}:${endpoint.elevation}`;
const endpointSetKey = (endpoints: readonly RouteEndpointV1[]): string =>
  [...endpoints]
    .sort((left, right) => sideIndex(left.side) - sideIndex(right.side) || left.elevation - right.elevation)
    .map(endpointKey)
    .join('|');

const cloneEndpoint = (raw: unknown, label: string): RouteEndpointV1 => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'side') ||
    !Object.hasOwn(value, 'elevation') ||
    !SIDES.includes(value.side as RouteSideV1) ||
    !Number.isSafeInteger(value.elevation) ||
    (value.elevation as number) < -1 ||
    (value.elevation as number) > 1
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze({ side: value.side as RouteSideV1, elevation: value.elevation as -1 | 0 | 1 });
};

const cloneEdge = (raw: unknown, label: string): RouteDirectedEdgeV1 => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 4 ||
    !Object.hasOwn(value, 'entry') ||
    !Object.hasOwn(value, 'exit') ||
    !Object.hasOwn(value, 'curve') ||
    !Object.hasOwn(value, 'slopeDelta')
  )
    throw new TypeError(`${label} fields are invalid.`);
  const entry = cloneEndpoint(value.entry, `${label} entry`);
  const exit = cloneEndpoint(value.exit, `${label} exit`);
  if (endpointKey(entry) === endpointKey(exit)) throw new TypeError(`${label} endpoints must differ.`);
  if (value.curve !== 'line' && value.curve !== 'quarter') throw new TypeError(`${label} curve is invalid.`);
  const slopeDelta = value.slopeDelta;
  if (
    !Number.isSafeInteger(slopeDelta) ||
    (slopeDelta as number) < -1 ||
    (slopeDelta as number) > 1 ||
    slopeDelta !== exit.elevation - entry.elevation
  )
    throw new TypeError(`${label} slope delta is invalid.`);
  if (value.curve === 'line' && !opposite(entry.side, exit.side))
    throw new TypeError(`${label} line endpoints must be opposite.`);
  if (value.curve === 'quarter' && (!adjacent(entry.side, exit.side) || slopeDelta !== 0))
    throw new TypeError(`${label} quarter curve must be flat with adjacent endpoints.`);
  return Object.freeze({ entry, exit, curve: value.curve, slopeDelta: slopeDelta as -1 | 0 | 1 });
};

const edgeKey = (edge: RouteDirectedEdgeV1): string => `${endpointKey(edge.entry)}>${endpointKey(edge.exit)}`;
const reverseEdgeKey = (edge: RouteDirectedEdgeV1): string => `${endpointKey(edge.exit)}>${endpointKey(edge.entry)}`;

export function defineRouteDefinitionV1(input: RouteDefinitionInputV1): RouteDefinitionV1 {
  if (!input || input.version !== 1) throw new TypeError('Route definition version is invalid.');
  if (typeof input.family !== 'string' || !NAMESPACE_ID.test(input.family))
    throw new TypeError('Route family must be namespace-qualified.');
  if (!Array.isArray(input.variants) || input.variants.length === 0 || input.variants.length > MAX_VARIANTS)
    throw new TypeError('Route variants are invalid.');
  const variantIds = new Set<string>();
  const endpointPairs = new Set<string>();
  const variants = input.variants.map((source: RouteVariantDefinitionV1, index: number) => {
    if (typeof source.variant !== 'string' || !NAMESPACE_ID.test(source.variant))
      throw new TypeError(`Route variant ${index} must be namespace-qualified.`);
    if (variantIds.has(source.variant)) throw new TypeError(`Duplicate route variant: ${source.variant}`);
    if (!Array.isArray(source.edges) || source.edges.length !== 2)
      throw new TypeError(`Route variant ${source.variant} must define two directed edges.`);
    const edges = source.edges.map((edge: RouteDirectedEdgeV1, edgeIndex: number) =>
      cloneEdge(edge, `Route variant ${source.variant} edge ${edgeIndex}`),
    );
    const edgeKeys = new Set(edges.map(edgeKey));
    if (edgeKeys.size !== edges.length || !edges.every((edge) => edgeKeys.has(reverseEdgeKey(edge))))
      throw new TypeError(`Route variant ${source.variant} edges must be unique and bidirectional.`);
    const [first, second] = edges;
    if (first!.curve !== second!.curve || first!.slopeDelta !== -second!.slopeDelta)
      throw new TypeError(`Route variant ${source.variant} reverse edge geometry is inconsistent.`);
    const pair = endpointSetKey([first!.entry, first!.exit]);
    if (endpointPairs.has(pair)) throw new TypeError(`Duplicate route endpoint pair: ${pair}`);
    endpointPairs.add(pair);
    variantIds.add(source.variant);
    return Object.freeze({ variant: source.variant, edges: Object.freeze(edges) });
  });

  const tieBreakInputs = input.placementTieBreaks ?? [];
  if (!Array.isArray(tieBreakInputs) || tieBreakInputs.length > MAX_TIE_BREAKS)
    throw new TypeError('Route placement tie-breaks are invalid.');
  const tieBreakKeys = new Set<string>();
  const placementTieBreaks = tieBreakInputs.map((source: RoutePlacementTieBreakV1, index: number) => {
    if (!variantIds.has(source.variant)) throw new TypeError(`Route tie-break ${index} references an unknown variant.`);
    if (!Array.isArray(source.connected) || source.connected.length < 2)
      throw new TypeError(`Route tie-break ${index} connected endpoints are invalid.`);
    const connected = source.connected.map((endpoint) => cloneEndpoint(endpoint, `Route tie-break ${index} endpoint`));
    const keys = new Set(connected.map(endpointKey));
    if (keys.size !== connected.length) throw new TypeError(`Route tie-break ${index} endpoints are duplicated.`);
    const variant = variants.find((candidate) => candidate.variant === source.variant)!;
    if (!variant.edges.every((edge) => keys.has(endpointKey(edge.entry)) && keys.has(endpointKey(edge.exit))))
      throw new TypeError(`Route tie-break ${index} does not contain its selected variant endpoints.`);
    const key = endpointSetKey(connected);
    if (tieBreakKeys.has(key)) throw new TypeError(`Duplicate route placement tie-break: ${key}`);
    tieBreakKeys.add(key);
    return Object.freeze({
      connected: Object.freeze(
        [...connected].sort(
          (left, right) => sideIndex(left.side) - sideIndex(right.side) || left.elevation - right.elevation,
        ),
      ),
      variant: source.variant,
    });
  });

  return Object.freeze({
    version: 1,
    family: input.family,
    variants: Object.freeze(variants),
    placementTieBreaks: Object.freeze(placementTieBreaks),
  });
}

const sameEndpoint = (left: RouteEndpointV1, right: RouteEndpointV1): boolean =>
  left.side === right.side && left.elevation === right.elevation;

const segmentLength = (edge: RouteDirectedEdgeV1): number =>
  edge.curve === 'quarter' ? Math.PI / 4 : Math.hypot(1, edge.slopeDelta);

export function validateRouteSegmentV1(raw: RouteSegmentV1): RouteSegmentV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Route segment is invalid.');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 4 ||
    !Object.hasOwn(value, 'family') ||
    !Object.hasOwn(value, 'variant') ||
    !Object.hasOwn(value, 'edge') ||
    !Object.hasOwn(value, 'length') ||
    typeof value.family !== 'string' ||
    !NAMESPACE_ID.test(value.family) ||
    typeof value.variant !== 'string' ||
    !NAMESPACE_ID.test(value.variant) ||
    !Number.isFinite(value.length) ||
    (value.length as number) <= 0
  )
    throw new TypeError('Route segment is invalid.');
  const edge = cloneEdge(value.edge, 'Route segment edge');
  const length = segmentLength(edge);
  if (Math.abs(length - (value.length as number)) > Number.EPSILON)
    throw new TypeError('Route segment length does not match its edge.');
  return Object.freeze({ family: value.family, variant: value.variant, edge, length });
}

export function resolveRouteSegmentV1(
  definition: RouteDefinitionV1,
  input: Readonly<{ entry: RouteEndpointV1; neighbors: readonly RouteNeighborV1[] }>,
): RouteResolutionV1 {
  const entry = cloneEndpoint(input.entry, 'Route entry');
  if (!Array.isArray(input.neighbors)) throw new TypeError('Route neighbors are invalid.');
  const states = new Map<string, RouteNeighborStateV1>();
  for (const [index, neighbor] of input.neighbors.entries()) {
    if (!neighbor || !['connected', 'disconnected', 'unknown'].includes(neighbor.state))
      throw new TypeError(`Route neighbor ${index} state is invalid.`);
    const endpoint = cloneEndpoint(neighbor.endpoint, `Route neighbor ${index} endpoint`);
    const key = endpointKey(endpoint);
    if (states.has(key)) throw new TypeError(`Duplicate route neighbor endpoint: ${key}`);
    states.set(key, neighbor.state);
  }

  const outgoing = definition.variants.flatMap((variant) =>
    variant.edges
      .filter((edge) => sameEndpoint(edge.entry, entry))
      .map((edge) => Object.freeze({ variant: variant.variant, edge })),
  );
  const relevant = [entry, ...outgoing.map(({ edge }) => edge.exit)];
  const unknown = relevant.filter(
    (endpoint) => states.get(endpointKey(endpoint)) === undefined || states.get(endpointKey(endpoint)) === 'unknown',
  );
  if (unknown.length)
    return Object.freeze({
      status: 'unknown',
      endpoints: Object.freeze(
        [...new Map(unknown.map((endpoint) => [endpointKey(endpoint), endpoint])).values()].sort(
          (left, right) => sideIndex(left.side) - sideIndex(right.side) || left.elevation - right.elevation,
        ),
      ),
    });
  if (states.get(endpointKey(entry)) !== 'connected') return Object.freeze({ status: 'disconnected' });
  const candidates = outgoing.filter(({ edge }) => states.get(endpointKey(edge.exit)) === 'connected');
  if (!candidates.length) return Object.freeze({ status: 'disconnected' });
  let selected = candidates.length === 1 ? candidates[0] : undefined;
  if (!selected) {
    const connected = input.neighbors
      .filter((neighbor) => neighbor.state === 'connected')
      .map((neighbor) => neighbor.endpoint);
    const tieBreak = definition.placementTieBreaks.find(
      (rule) => endpointSetKey(rule.connected) === endpointSetKey(connected),
    );
    if (tieBreak) selected = candidates.find((candidate) => candidate.variant === tieBreak.variant);
  }
  if (!selected)
    return Object.freeze({
      status: 'ambiguous',
      variants: Object.freeze(candidates.map(({ variant }) => variant).sort()),
    });
  return Object.freeze({
    status: 'segment',
    segment: Object.freeze({
      family: definition.family,
      variant: selected.variant,
      edge: selected.edge,
      length: segmentLength(selected.edge),
    }),
  });
}

const endpointPosition = (endpoint: RouteEndpointV1): readonly [number, number, number] => {
  if (endpoint.side === 'north') return [0.5, endpoint.elevation, 0];
  if (endpoint.side === 'east') return [1, endpoint.elevation, 0.5];
  if (endpoint.side === 'south') return [0.5, endpoint.elevation, 1];
  return [0, endpoint.elevation, 0.5];
};

const curveCenter = (entry: RouteSideV1, exit: RouteSideV1): readonly [number, number] => [
  entry === 'east' || exit === 'east' ? 1 : 0,
  entry === 'south' || exit === 'south' ? 1 : 0,
];

const normalizedQuarterDelta = (from: number, to: number): number => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

export function advanceRouteSegmentV1(segment: RouteSegmentV1, progress: number, distance: number): RouteProgressV1 {
  const validated = validateRouteSegmentV1(segment);
  if (
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > validated.length ||
    !Number.isFinite(distance) ||
    distance < 0
  )
    throw new TypeError('Route progress input is invalid.');
  const remaining = validated.length - progress;
  const traveled = Math.min(remaining, distance);
  const nextProgress = progress + traveled;
  const overshoot = Math.max(0, distance - remaining);
  const ratio = nextProgress / validated.length;
  const start = endpointPosition(validated.edge.entry);
  const end = endpointPosition(validated.edge.exit);
  let position: readonly [number, number, number];
  let tangent: readonly [number, number, number];
  if (validated.edge.curve === 'line') {
    const vector = [end[0] - start[0], end[1] - start[1], end[2] - start[2]] as const;
    const length = Math.hypot(...vector);
    position = [start[0] + vector[0] * ratio, start[1] + vector[1] * ratio, start[2] + vector[2] * ratio];
    tangent = [vector[0] / length, vector[1] / length, vector[2] / length];
  } else {
    const [centerX, centerZ] = curveCenter(validated.edge.entry.side, validated.edge.exit.side);
    const from = Math.atan2(start[2] - centerZ, start[0] - centerX);
    const to = Math.atan2(end[2] - centerZ, end[0] - centerX);
    const delta = normalizedQuarterDelta(from, to);
    const angle = from + delta * ratio;
    const direction = Math.sign(delta);
    position = [centerX + Math.cos(angle) * 0.5, start[1], centerZ + Math.sin(angle) * 0.5];
    tangent = [-Math.sin(angle) * direction, 0, Math.cos(angle) * direction];
  }
  if (![nextProgress, overshoot, ...position, ...tangent].every(Number.isFinite))
    throw new Error('Route progress produced a non-finite result.');
  return Object.freeze({
    progress: nextProgress,
    overshoot,
    position: Object.freeze(position),
    tangent: Object.freeze(tangent),
  });
}
