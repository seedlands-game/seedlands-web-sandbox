# Rebase Player Ground Collision onto the Quality Architecture

**Status:** Complete

## Context & Goal

Rebase the eight commits from `origin/codex/player-ground-collision` onto the current app/world/worker quality architecture without restoring obsolete source paths or test runners.

## Scope & Non-goals

- In scope: flat-ground contact, center-ground support, one-block step-down depenetration, current Playwright coverage, and migration of source change records.
- Non-goals: step climbing, swept collision, a physics-engine replacement, remote branch rewrites, or a remote push.

## Decisions

- Rebase a local integration branch from common ancestor `8c8af8d` onto `f3282d7`; leave the published source branch unchanged.
- Keep collision and Harness setup in `src/app/main.ts`; fixtures invoke production `World.edit()` and browser assertions belong in `tests/e2e/regression/`.
- Use explicit state arguments for page-side waits so tests do not capture non-serializable Node-side closures or rely on fixed sleeps.

## Behaviour

- Given a flat platform, when the player walks, then movement remains possible without floor overlap.
- Given the center ground voxel is excavated, when the player has neighboring footprint overlap, then the player falls and Space cannot re-arm jumping.
- Given a one-block step-down, when horizontal movement reduces existing overlap, then movement continues to the lower surface; overlap-increasing motion remains blocked.

## Acceptance & Evidence

- [x] Eight source commits rebase locally with current paths and no old runner restored.
- [x] `corepack pnpm verify:static` passes; `src/world/**` line coverage is 94.56%.
- [x] `corepack pnpm build` and `corepack pnpm harness` pass; Harness reports browser regression and benchmark `PASS`.
- [x] Original current branch fast-forwarded to the completed local integration branch; no remote push.

## Tasks & Current State

1. [x] Fetch source branch and compare its eight commits to the current architecture.
2. [x] Rebase, resolve obsolete paths, migrate collision behavior and deterministic browser tests.
3. [x] Run static, build, Chromium and Harness verification.
4. [x] Commit the migration record and fast-forward the original current branch.

## Delivery Snapshot

Rebased commits: `429a673`, `c930b5b`, `da6498b`, `22e9054`, `17abcdd`, `2f987d5`, `08f1439`, and `3601250`.

Actual validation: `corepack pnpm verify:static` passed (30 Vitest tests; 94.56% world line coverage); `corepack pnpm build` passed with the existing non-blocking Vite main-bundle warning; `corepack pnpm harness` passed (9 Chromium tests, browser regression PASS, browser benchmark PASS).

`codex/sync-main-quality-e2e` was fast-forwarded to `7b815ed`; no remote push or force-push was performed. Local `main` remains unchanged because this request scoped the update to the current branch.
