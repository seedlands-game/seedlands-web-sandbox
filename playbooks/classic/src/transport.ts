import {
  defineRouteDefinitionV1,
  defineTransportInteractionModule,
  defineTransportRelationModule,
  defineTransportMotionModule,
  defineTransportStorageModule,
} from '@seedlands/stdlib/mod-api';

const ordinaryRailVariants = [
  {
    variant: 'seedlands:rail-east-west',
    edges: [
      { entry: { side: 'west', elevation: 0 }, exit: { side: 'east', elevation: 0 }, curve: 'line', slopeDelta: 0 },
      { entry: { side: 'east', elevation: 0 }, exit: { side: 'west', elevation: 0 }, curve: 'line', slopeDelta: 0 },
    ],
  },
  {
    variant: 'seedlands:rail-north-south',
    edges: [
      { entry: { side: 'north', elevation: 0 }, exit: { side: 'south', elevation: 0 }, curve: 'line', slopeDelta: 0 },
      { entry: { side: 'south', elevation: 0 }, exit: { side: 'north', elevation: 0 }, curve: 'line', slopeDelta: 0 },
    ],
  },
  {
    variant: 'seedlands:rail-north-east',
    edges: [
      {
        entry: { side: 'north', elevation: 0 },
        exit: { side: 'east', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
      {
        entry: { side: 'east', elevation: 0 },
        exit: { side: 'north', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
    ],
  },
  {
    variant: 'seedlands:rail-east-south',
    edges: [
      {
        entry: { side: 'east', elevation: 0 },
        exit: { side: 'south', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
      {
        entry: { side: 'south', elevation: 0 },
        exit: { side: 'east', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
    ],
  },
  {
    variant: 'seedlands:rail-south-west',
    edges: [
      {
        entry: { side: 'south', elevation: 0 },
        exit: { side: 'west', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
      {
        entry: { side: 'west', elevation: 0 },
        exit: { side: 'south', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
    ],
  },
  {
    variant: 'seedlands:rail-west-north',
    edges: [
      {
        entry: { side: 'west', elevation: 0 },
        exit: { side: 'north', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
      {
        entry: { side: 'north', elevation: 0 },
        exit: { side: 'west', elevation: 0 },
        curve: 'quarter',
        slopeDelta: 0,
      },
    ],
  },
  {
    variant: 'seedlands:rail-ascending-north',
    edges: [
      { entry: { side: 'south', elevation: 0 }, exit: { side: 'north', elevation: 1 }, curve: 'line', slopeDelta: 1 },
      {
        entry: { side: 'north', elevation: 1 },
        exit: { side: 'south', elevation: 0 },
        curve: 'line',
        slopeDelta: -1,
      },
    ],
  },
  {
    variant: 'seedlands:rail-ascending-east',
    edges: [
      { entry: { side: 'west', elevation: 0 }, exit: { side: 'east', elevation: 1 }, curve: 'line', slopeDelta: 1 },
      { entry: { side: 'east', elevation: 1 }, exit: { side: 'west', elevation: 0 }, curve: 'line', slopeDelta: -1 },
    ],
  },
  {
    variant: 'seedlands:rail-ascending-south',
    edges: [
      { entry: { side: 'north', elevation: 0 }, exit: { side: 'south', elevation: 1 }, curve: 'line', slopeDelta: 1 },
      {
        entry: { side: 'south', elevation: 1 },
        exit: { side: 'north', elevation: 0 },
        curve: 'line',
        slopeDelta: -1,
      },
    ],
  },
  {
    variant: 'seedlands:rail-ascending-west',
    edges: [
      { entry: { side: 'east', elevation: 0 }, exit: { side: 'west', elevation: 1 }, curve: 'line', slopeDelta: 1 },
      { entry: { side: 'west', elevation: 1 }, exit: { side: 'east', elevation: 0 }, curve: 'line', slopeDelta: -1 },
    ],
  },
] as const;

/** Only two physical directions choose a shape; three/four-way junctions remain closed. */
export const classicMinecartRoute = defineRouteDefinitionV1({
  version: 1,
  family: 'seedlands:ordinary-rail',
  variants: ordinaryRailVariants,
  // A neighboring rail can expose both low/high endpoint probes. Prefer the
  // ground-level shape when both ends are level; a raised-only end selects a slope.
  placementTieBreaks: [
    ...ordinaryRailVariants.map(({ variant, edges: [edge] }) => ({
      variant,
      connected: [
        edge.entry,
        edge.exit,
        { ...edge.entry, elevation: 1 as const },
        ...(edge.slopeDelta === 0 ? [{ ...edge.exit, elevation: 1 as const }] : []),
      ],
    })),
    // At a crest, the lower neighboring slope exposes only the level endpoint.
    // The opposite same-level rail still exposes both level and raised probes.
    ...ordinaryRailVariants
      .filter(({ edges: [edge] }) => edge.curve === 'line' && edge.slopeDelta === 0)
      .flatMap(({ variant, edges: [edge] }) =>
        [edge.entry, edge.exit].map((level) => ({
          variant,
          connected: [edge.entry, edge.exit, { ...level, elevation: 1 as const }],
        })),
      ),
  ],
});

export const classicTransportModules = [
  defineTransportInteractionModule({
    moduleId: 'seedlands:overworld-transport-deployments',
    operationId: 'seedlands:deploy-minecart',
    definitions: [
      {
        version: 1,
        id: 'seedlands:minecart',
        locomotion: { provider: 'route', providerId: classicMinecartRoute.family },
        bodyAabb: { min: { x: -0.45, y: 0, z: -0.45 }, max: { x: 0.45, y: 0.7, z: 0.45 } },
        seatOffset: [0, 0.55, 0],
        fuelCapacity: null,
        inventoryCapacity: null,
        presentationId: 'seedlands:minecart',
      },
      {
        version: 1,
        id: 'seedlands:chest-minecart',
        locomotion: { provider: 'route', providerId: classicMinecartRoute.family },
        bodyAabb: { min: { x: -0.45, y: 0, z: -0.45 }, max: { x: 0.45, y: 0.7, z: 0.45 } },
        seatOffset: [0, 0.55, 0],
        fuelCapacity: null,
        inventoryCapacity: 27,
        presentationId: 'seedlands:chest-minecart',
      },
      {
        version: 1,
        id: 'seedlands:furnace-minecart',
        locomotion: { provider: 'route', providerId: classicMinecartRoute.family },
        bodyAabb: { min: { x: -0.45, y: 0, z: -0.45 }, max: { x: 0.45, y: 0.7, z: 0.45 } },
        seatOffset: [0, 0.55, 0],
        fuelCapacity: 1440,
        inventoryCapacity: null,
        presentationId: 'seedlands:furnace-minecart',
      },
      {
        version: 1,
        id: 'seedlands:boat',
        locomotion: { provider: 'surface', providerId: 'seedlands:water-surface' },
        bodyAabb: { min: { x: -0.75, y: 0, z: -0.75 }, max: { x: 0.75, y: 0.6, z: 0.75 } },
        seatOffset: [0, 0.45, 0],
        fuelCapacity: null,
        inventoryCapacity: null,
        presentationId: 'seedlands:boat',
      },
    ],
    deployments: [
      { itemId: 'minecart', definitionId: 'seedlands:minecart' },
      { itemId: 'chest-minecart', definitionId: 'seedlands:chest-minecart' },
      { itemId: 'furnace-minecart', definitionId: 'seedlands:furnace-minecart' },
      { itemId: 'boat', definitionId: 'seedlands:boat' },
    ],
    routes: [{ definition: classicMinecartRoute, voxels: [39] }],
    surfaces: [{ id: 'seedlands:water-surface', voxels: [8], surfaceOffset: 0.8 }],
  }),
  defineTransportRelationModule({
    moduleId: 'seedlands:overworld-transport-relations',
    operationId: 'seedlands:mount-minecart',
    mountableDefinitions: ['seedlands:minecart', 'seedlands:boat'],
  }),
  defineTransportMotionModule({
    moduleId: 'seedlands:overworld-transport-motion',
    operationId: 'seedlands:move-minecart',
    systemId: 'seedlands:minecart-motion',
    policies: [
      { definitionId: 'seedlands:minecart', acceleration: 2, drag: 0.4, maxSpeed: 8, steeringRate: 0, fuelPerMeter: 0 },
      {
        definitionId: 'seedlands:chest-minecart',
        acceleration: 2,
        drag: 0.4,
        maxSpeed: 8,
        steeringRate: 0,
        fuelPerMeter: 0,
      },
      {
        definitionId: 'seedlands:furnace-minecart',
        acceleration: 2,
        drag: 0.4,
        maxSpeed: 4,
        steeringRate: 0,
        fuelPerMeter: 1,
        throttleSource: 'fuel',
      },
      {
        definitionId: 'seedlands:boat',
        acceleration: 2,
        drag: 0.8,
        maxSpeed: 5,
        steeringRate: Math.PI / 2,
        fuelPerMeter: 0,
      },
    ],
  }),
  defineTransportStorageModule({
    moduleId: 'seedlands:overworld-transport-storage',
    operationId: 'seedlands:store-transport',
    fuels: [{ definitionId: 'seedlands:furnace-minecart', itemId: 'coal', units: 720 }],
  }),
] as const;
