import { FaceMaterial } from './voxel';

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
export const faceMaterialNames: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(FaceMaterial).map(([name, id]) => [id, name === 'JackOLantern' ? 'jack-o-lantern' : kebab(name)]),
  ),
);
