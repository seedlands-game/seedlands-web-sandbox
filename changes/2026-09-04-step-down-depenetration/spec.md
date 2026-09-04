# Step-down Depenetration

**Status:** Delivered locally

## Context & Goal

With center-of-mass grounding, crossing a one-voxel downward ledge correctly starts a fall as soon as the player center enters the lower column. During that fall, the rear of the full-width AABB can overlap the previous higher voxel. Horizontal movement currently reverts every candidate that is colliding, including movement that would reduce an already-existing overlap, so the player can settle one level lower while half embedded and become unable to move.

Complete when normal forward movement carries the player down a one-voxel step, settles at the lower height, and leaves no collision overlap.

## Scope & Non-goals

- In scope: reproduce the one-voxel step-down and allow horizontal movement that resolves existing penetration.
- Non-goals: upward step climbing, slopes, crouching, or replacing the controller with a physics engine.

## Decisions

Preserve normal collision rejection from a clear position, but when vertical movement has already introduced overlap, allow only horizontal candidates that strictly reduce exact AABB/voxel intersection volume. Exact overlap replaces the previous Boolean corner sample for horizontal collision state; the same foot/head epsilon excludes touching floor and ceiling faces from penetration volume.

## Behaviour

- Given an upper flat platform adjoining a platform one voxel lower, When the player walks forward across the edge, Then the player continues forward and settles exactly one voxel lower.
- Given vertical descent has introduced overlap with the rear ledge, When horizontal motion points out of that overlap, Then the motion is accepted only while overlap decreases.
- Given a clear player approaching a wall or a movement that increases overlap, When horizontal motion is attempted, Then it remains blocked.

## Acceptance & Evidence

- [x] The new Chromium step-down regression fails before the production fix and passes after it.
- [x] Existing flat movement, center excavation, jump, interaction, streaming, map, and persistence regressions remain green.
- [x] Deterministic checks, production build, and `git diff --check` pass.

## Tasks & Current State

1. [done] Reproduce the step-down overlap and capture position/collision state.
2. [done] Implement monotonic horizontal depenetration.
3. [done] Validate and record delivery evidence.

## Delivery Snapshot

Changed paths after rebase: `src/app/main.ts`, `tests/e2e/support/harness.ts`, `tests/e2e/regression/world-play.spec.ts`, and this change record.

Current validation: the step-down Playwright regression builds adjacent upper/lower surfaces through production `World.edit()`, drives real Pointer Lock and forward input, waits for more than three units of forward progress at the lower resting height, and requires a non-colliding final body. `corepack pnpm verify:static`, `corepack pnpm build`, and `corepack pnpm harness` passed on the rebased branch.

Known limitation: the controller remains axis-separated and does not add upward step climbing or swept high-speed collision. The depenetration exception is monotonic: it only accepts a colliding horizontal candidate when its exact AABB/voxel overlap volume is lower than the current overlap.

Git: rebased implementation commit `08f1439` on `codex/player-ground-collision-integration`; no remote push requested.
