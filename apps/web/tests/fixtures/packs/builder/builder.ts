import { definePack } from '@seedlands/stdlib/mod-api';
import { buildingModules } from './building-content';

export const pack = definePack({
  id: 'seedlands:builder',
  version: '1.0.0',
  kind: 'playbook',
  entry: 'builder.mjs',
  modules: buildingModules(false),
});
