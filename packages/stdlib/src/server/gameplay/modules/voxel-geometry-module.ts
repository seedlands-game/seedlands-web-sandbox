import type { ModModule } from '../../composition/contracts';
import { VOXEL_SEMANTICS_CAPABILITY } from './content-capabilities';
import {
  createVoxelGeometryRegistryV1,
  type VoxelGeometryDefinitionV1,
  type VoxelGeometryRegistryV1,
} from '../../../world/voxel-geometry';

export const VOXEL_GEOMETRY_CAPABILITY = 'seedlands:voxel-geometry';
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;

export type VoxelGeometryModuleOptionsV1 = Readonly<{
  moduleId: string;
  descriptors: readonly VoxelGeometryDefinitionV1[];
}>;

export function defineVoxelGeometryModule(options: VoxelGeometryModuleOptionsV1): ModModule {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Voxel geometry module options are invalid.');
  if (
    Object.keys(options).length !== 2 ||
    !Object.hasOwn(options, 'moduleId') ||
    !Object.hasOwn(options, 'descriptors')
  )
    throw new TypeError('Voxel geometry module option fields are invalid.');
  if (!NAMESPACE_ID.test(options.moduleId)) throw new TypeError('Voxel geometry module id is invalid.');
  const source = createVoxelGeometryRegistryV1(options.descriptors).list();
  return Object.freeze({
    descriptor: Object.freeze({
      id: options.moduleId,
      version: '1.0.0',
      requires: Object.freeze([Object.freeze({ id: VOXEL_SEMANTICS_CAPABILITY, version: '1.0.0' })]),
      provides: Object.freeze([Object.freeze({ id: VOXEL_GEOMETRY_CAPABILITY, version: '1.0.0' })]),
    }),
    register(api) {
      api.requireCapability(VOXEL_SEMANTICS_CAPABILITY);
      const registry = createVoxelGeometryRegistryV1(source);
      api.provideCapability<VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY, registry);
      api.onDefinitionsReady(() => {
        const semantics = new Map(api.readContentDefinitions().voxels.map((voxel) => [voxel.storageId, voxel]));
        for (const descriptor of registry.list()) {
          const voxel = semantics.get(descriptor.voxel);
          if (!voxel) throw new TypeError(`Geometry voxel ${descriptor.voxel} is not registered.`);
          if (!voxel.renderable) throw new TypeError(`Geometry voxel ${descriptor.voxel} is not renderable.`);
          const materials = new Set(voxel.faceMaterials);
          for (const box of descriptor.boxes)
            if (!materials.has(box.material))
              throw new TypeError(`Geometry material ${box.material} is not registered for voxel ${descriptor.voxel}.`);
          if (voxel.solid !== descriptor.collision.length > 0)
            throw new TypeError(`Geometry collision does not match voxel semantics: ${descriptor.voxel}.`);
        }
      });
    },
  });
}
