# TEST-FIX-01 Inventory Pointer Fixture Closure

## Scope

This checkpoint updates only the inventory pointer test fixture shape after `InventoryCursorV1.craftingGrid` became required. Production types and behavior are unchanged.

## RED

The existing root test typecheck reported `TS2322` at eight uses in `packages/stdlib/tests/server/inventory-pointer-model.test.ts`: lines 84, 94, 131, 149, 176, 255, 277, and 283. Each error originated from a shared or locally overridden cursor fixture that omitted the required personal crafting grid.

The production default in `emptyInventoryCursor()` is a four-slot empty grid, so the compatible fixture value is `[null, null, null, null]`. Existing tests with populated crafting grids already use the same four-slot shape.

## GREEN

- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/inventory-pointer-model.test.ts --maxWorkers=1`: 1 file, 9/9 tests passed.
- `node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false`: all eight inventory-pointer errors are closed. The command remains nonzero only for the out-of-scope `packages/stdlib/tests/server/structure-operation-model.test.ts:91` mode string narrowing error.
- Targeted Prettier and ESLint checks passed. Targeted `git diff --check` passed.
- No production file, browser, build, full test suite, commit, or push was involved.

## Files

```text
bbcd07e2757853c4e5d02572ad442413180dbd6d07d97f748f3b86413914288d  packages/stdlib/tests/server/inventory-pointer-model.test.ts
```

The evidence file hash is reported after this file is finalized.
