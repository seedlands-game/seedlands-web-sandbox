<script lang="ts">
  import GameButton from './primitives/game-button.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import type { ShellState, UiActionPort } from './ui-contracts';
  let {
    recipes,
    holding,
    oncraft,
  }: {
    recipes: ShellState['gameplay']['recipes'];
    holding: boolean;
    oncraft: UiActionPort['craftRecipe'];
  } = $props();
  let filter = $state('');
  const visibleRecipes = $derived(
    recipes.filter((recipe) => recipe.name.toLowerCase().includes(filter.trim().toLowerCase())),
  );
</script>

<aside class="personal-recipes" aria-label="合成配方">
  <h3>快捷合成</h3>
  <GameTextField id="recipe-filter" label="筛选配方" bind:value={filter} placeholder="搜索配方" />
  <div role="list" aria-label="合成配方">
    {#each visibleRecipes as recipe (recipe.id)}
      <div role="listitem" class:available={recipe.craftable}>
        <strong>{recipe.name}</strong><small>{recipe.requirements} → {recipe.result}</small>
        <GameButton
          label={`${recipe.craftable ? '合成' : '缺少材料'} ${recipe.name}`}
          disabled={!recipe.craftable || holding}
          onclick={() => oncraft(recipe.id)}>{recipe.craftable ? '合成' : '缺材料'}</GameButton
        >
      </div>
    {:else}<p>没有符合条件的配方。</p>{/each}
  </div>
</aside>

<style>
  .personal-recipes {
    border-left: 1px solid #79633f60;
    padding-left: 18px;
  }
  .personal-recipes h3 {
    margin-bottom: 12px;
  }
  .personal-recipes :global(input) {
    width: 100%;
    box-sizing: border-box;
  }
  .personal-recipes [role='list'] {
    max-height: 267px;
    overflow: auto;
    margin-top: 10px;
  }
  .personal-recipes [role='listitem'] {
    padding: 9px 0;
    border-bottom: 1px solid #ffffff10;
    display: grid;
    gap: 6px;
  }
  .personal-recipes strong {
    font-size: 12px;
  }
  .personal-recipes small {
    font-size: 10px;
    color: #a9a794;
  }
  .personal-recipes :global(.game-button) {
    width: 100%;
    padding: 4px;
    min-height: 25px;
    font-size: 11px;
  }
  @media (max-width: 720px) {
    .personal-recipes {
      border: 0;
      padding: 0;
    }
    .personal-recipes [role='list'] {
      max-height: 120px;
    }
  }
</style>
