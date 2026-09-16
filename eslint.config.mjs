import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeedlandsConfig } from '@seedlands/eslint-plugin/config';

export default createSeedlandsConfig(dirname(fileURLToPath(import.meta.url)));
