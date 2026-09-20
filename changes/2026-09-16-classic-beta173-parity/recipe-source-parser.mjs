export function createRecipeSourceParser(symbolIds) {
  const resolveSymbol = (value) => {
    const symbol = value.match(/^(?:Item|Block)\.\w+/)?.[0];
    if (!symbolIds.has(symbol)) throw new Error(`Unresolved reference symbol: ${value}`);
    return symbolIds.get(symbol);
  };
  const parseStack = (value) => {
    const match = value.match(/^new ItemStack\(([^)]*)\)$/);
    if (!match) throw new Error(`Invalid ItemStack registration: ${value}`);
    const [symbol, count = '1', metadata = '0'] = match[1].split(',').map((part) => part.trim());
    if (!/^\d+$/.test(count) || !/^-?\d+$/.test(metadata)) throw new Error(`Non-literal ItemStack: ${value}`);
    return { id: resolveSymbol(symbol), count: Number(count), metadata: Number(metadata) };
  };
  const parseIngredient = (value) => {
    if (value.startsWith('new ItemStack(')) {
      const { id, metadata } = parseStack(value);
      return { id, metadata };
    }
    return { id: resolveSymbol(value), metadata: value.startsWith('Block.') ? -1 : 0 };
  };
  return { resolveSymbol, parseStack, parseIngredient };
}
