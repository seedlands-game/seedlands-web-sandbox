<script lang="ts">
  import type { InteractionState } from './ui-contracts';

  let { entities }: { entities: InteractionState['presentedEntities'] } = $props();
</script>

<div id="presented-entity-semantics" aria-label="附近实体">
  {#each entities as entity (entity.id)}
    <span
      role="img"
      aria-label={entity.label}
      data-entity-id={entity.id}
      data-entity-type={entity.type}
      data-archetype={entity.archetype ?? ''}
      data-behavior={entity.behavior ?? ''}
      data-position={entity.position.join(',')}
    ></span>
  {/each}
</div>
