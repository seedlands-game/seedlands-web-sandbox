import { overworldItems } from '@seedlands/playbook-classic/content/items';
import { createItemDefinitionRegistry } from '@seedlands/stdlib/server/gameplay/item-registry';

const classicItemDefinitions = createItemDefinitionRegistry(overworldItems, () => true);

export const requireClassicItemDefinition = (itemId: string) => classicItemDefinitions.require(itemId);
export const listClassicItemDefinitions = () => classicItemDefinitions.list();
