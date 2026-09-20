// Data transcribed as facts from the pinned Recipes* registration classes.
// This is a candidate reference table, not executable Minecraft code.
export function helperRecipeExpected(index) {
  // CraftingManager.addRecipe wraps a Block symbol as ItemStack(block, 1, -1).
  // Preserve that wildcard rather than silently treating it as default damage 0.
  const blockIngredient = (id) => ({ id, metadata: -1 });
  const tierInputs = [blockIngredient(5), blockIngredient(4), { id: 265 }, { id: 266 }, { id: 264 }];
  const toolOutputs = [
    [270, 274, 257, 285, 278],
    [271, 275, 258, 286, 279],
    [269, 273, 256, 284, 277],
    [290, 291, 292, 294, 293],
    [268, 272, 267, 283, 276],
  ];
  const toolGrids = [
    ['XXX', ' # ', ' # '],
    ['XX', 'X#', ' #'],
    ['X', '#', '#'],
    ['XX', ' #', ' #'],
    ['X', 'X', '#'],
  ];
  if (index <= 25) {
    const family = Math.floor((index - 1) / 5);
    const tier = (index - 1) % 5;
    return {
      type: 'shaped',
      output: { id: toolOutputs[family][tier], count: 1 },
      grid: toolGrids[family],
      symbols: { X: tierInputs[tier], '#': { id: 280 } },
    };
  }
  if (index === 26)
    return {
      type: 'shaped',
      output: { id: 261, count: 1 },
      grid: [' #X', '# X', ' #X'],
      symbols: { X: { id: 287 }, '#': { id: 280 } },
    };
  if (index === 27)
    return {
      type: 'shaped',
      output: { id: 262, count: 4 },
      grid: ['X', '#', 'Y'],
      symbols: { X: { id: 318 }, '#': { id: 280 }, Y: { id: 288 } },
    };

  const armorGroups = [
    { first: 28, outputs: [298, 299, 300, 301], material: 334 },
    { first: 32, outputs: [306, 307, 308, 309], material: 265 },
    { first: 36, outputs: [314, 315, 316, 317], material: 266 },
    { first: 40, outputs: [310, 311, 312, 313], material: 264 },
    { first: 90, outputs: [302, 303, 304, 305], material: 51 },
  ];
  const armorGrids = [
    ['XXX', 'X X'],
    ['X X', 'XXX', 'XXX'],
    ['XXX', 'X X', 'X X'],
    ['X X', 'X X'],
  ];
  for (const group of armorGroups) {
    if (index >= group.first && index <= group.first + 3) {
      const slot = index - group.first;
      return {
        type: 'shaped',
        output: { id: group.outputs[slot], count: 1 },
        grid: armorGrids[slot],
        symbols: { X: group.material === 51 ? blockIngredient(group.material) : { id: group.material } },
      };
    }
  }

  const compact = [
    { block: 42, item: 265 },
    { block: 41, item: 266 },
    { block: 57, item: 264 },
    { block: 22, item: 351, metadata: 4 },
  ];
  if (index >= 44 && index <= 51) {
    const pair = compact[Math.floor((index - 44) / 2)];
    return index % 2 === 0
      ? {
          type: 'shaped',
          output: { id: pair.block, count: 1 },
          grid: ['###', '###', '###'],
          symbols: { '#': { id: pair.item, ...(pair.metadata !== undefined ? { metadata: pair.metadata } : {}) } },
        }
      : {
          type: 'shaped',
          output: { id: pair.item, count: 9, ...(pair.metadata !== undefined ? { metadata: pair.metadata } : {}) },
          grid: ['#'],
          symbols: { '#': blockIngredient(pair.block) },
        };
  }
  if (index >= 52 && index <= 54) {
    const row = [
      { output: 58, input: 5, grid: ['##', '##'] },
      { output: 54, input: 5, grid: ['###', '# #', '###'] },
      { output: 61, input: 4, grid: ['###', '# #', '###'] },
    ][index - 52];
    return {
      type: 'shaped',
      output: { id: row.output, count: 1 },
      grid: row.grid,
      symbols: { '#': blockIngredient(row.input) },
    };
  }
  if (index === 55)
    return {
      type: 'shaped',
      output: { id: 282, count: 1 },
      alternatives: [
        { grid: ['Y', 'X', '#'], symbols: { Y: blockIngredient(40), X: blockIngredient(39), '#': { id: 281 } } },
        { grid: ['Y', 'X', '#'], symbols: { Y: blockIngredient(39), X: blockIngredient(40), '#': { id: 281 } } },
      ],
    };
  if (index === 56)
    return {
      type: 'shaped',
      output: { id: 357, count: 8 },
      grid: ['#X#'],
      symbols: { '#': { id: 296 }, X: { id: 351, metadata: 3 } },
    };

  const dye = (metadata, count, ingredients) => ({
    type: 'shapeless',
    output: { id: 351, metadata, count },
    ingredients,
  });
  const pigment = (metadata) => ({ id: 351, metadata });
  const dyeFacts = new Map([
    [57, dye(11, 2, [{ id: 37 }])],
    [58, dye(1, 2, [{ id: 38 }])],
    [59, dye(15, 3, [{ id: 352 }])],
    [60, dye(14, 2, [pigment(1), pigment(11)])],
    [61, dye(10, 2, [pigment(2), pigment(15)])],
    [62, dye(12, 2, [pigment(4), pigment(15)])],
    [63, dye(6, 2, [pigment(4), pigment(2)])],
    [64, dye(5, 2, [pigment(4), pigment(1)])],
    [65, dye(13, 2, [pigment(5), pigment(9)])],
    [66, dye(9, 2, [pigment(1), pigment(15)])],
    [67, dye(8, 2, [pigment(0), pigment(15)])],
    [68, dye(7, 2, [pigment(8), pigment(15)])],
    [87, dye(7, 3, [pigment(0), pigment(15), pigment(15)])],
    [88, dye(13, 3, [pigment(4), pigment(1), pigment(9)])],
    [89, dye(13, 4, [pigment(4), pigment(1), pigment(1), pigment(15)])],
  ]);
  if (dyeFacts.has(index)) return dyeFacts.get(index);
  if (index >= 69 && index <= 84) {
    const woolMetadata = index - 69;
    return {
      type: 'shapeless',
      output: { id: 35, metadata: woolMetadata, count: 1 },
      ingredients: [{ id: 35, metadata: 0 }, pigment(15 - woolMetadata)],
    };
  }
  if (index === 85)
    return { type: 'shaped', output: { id: 24, count: 1 }, grid: ['##', '##'], symbols: { '#': blockIngredient(12) } };
  if (index === 86)
    return { type: 'shaped', output: { id: 359, count: 1 }, grid: [' #', '# '], symbols: { '#': { id: 265 } } };
  throw new Error(`Unmapped H recipe ${index}`);
}

// RecipesDyes registers H87 as black + white + white, not white + black + black.
// Keep the source-sensitive multiplicity/order check executable for every importer.
export function assertHelperRecipeExpected() {
  const h87 = helperRecipeExpected(87);
  const h87Metadata = h87.ingredients.map((ingredient) => ingredient.metadata).join(',');
  if (
    h87.type !== 'shapeless' ||
    h87.output.id !== 351 ||
    h87.output.metadata !== 7 ||
    h87.output.count !== 3 ||
    h87Metadata !== '0,15,15'
  ) {
    throw new Error(`H87 must be black + white + white -> light gray x3; got ${JSON.stringify(h87)}`);
  }
}

assertHelperRecipeExpected();
