import {
  defineRouteDefinitionV1,
  defineTransportInteractionModule,
  defineTransportRelationModule,
  defineTransportMotionModule,
} from '@seedlands/stdlib/mod-api';

/** The first registered Classic slice uses ordinary, straight rail only. */
export const classicMinecartRoute = defineRouteDefinitionV1({
  version: 1,
  family: 'seedlands:ordinary-rail',
  variants: [
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
    ],
    deployments: [{ itemId: 'minecart', definitionId: 'seedlands:minecart' }],
    routes: [{ definition: classicMinecartRoute, voxels: [39] }],
    surfaces: [],
  }),
  defineTransportRelationModule({
    moduleId: 'seedlands:overworld-transport-relations',
    operationId: 'seedlands:mount-minecart',
  }),
  defineTransportMotionModule({
    moduleId: 'seedlands:overworld-transport-motion',
    operationId: 'seedlands:move-minecart',
    systemId: 'seedlands:minecart-motion',
    policies: [
      { definitionId: 'seedlands:minecart', acceleration: 2, drag: 0.4, maxSpeed: 8, steeringRate: 0, fuelPerMeter: 0 },
    ],
  }),
] as const;
