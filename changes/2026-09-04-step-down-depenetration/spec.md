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

Changed paths: `src/main.ts`, `scripts/browser-harness.mjs`, and this change record.

Pre-fix reproduction: `CI=true corepack pnpm harness:e2e` failed at `stepDown`. Walking forward from `[0.5, 58.599998, 0.5]` onto the platform one voxel lower ended at `[0.5, 57.599998, -0.007543]`: vertical landing succeeded, forward movement stopped at the boundary, and `colliding` was true. This isolates an existing-penetration deadlock after vertical descent rather than incorrect ground height, input loss, or delayed mesh state.

Post-fix validation: `CI=true corepack pnpm test` passed; `CI=true corepack pnpm build` passed; `git diff --check` passed; `CI=true corepack pnpm harness:e2e` passed. Chromium stages Load, Input, Player, FlatMovement, CenterExcavation, StepDown, Interaction, Streaming, MacroMap, and Persistence all passed. `StepDown` holds real forward input across a constructed one-voxel drop, requires more than three world units of progress, verifies the exact lower resting height, and requires final `colliding=false`.

Known limitation: the controller remains axis-separated and does not add upward step climbing or swept high-speed collision. The depenetration exception is monotonic: it only accepts a colliding horizontal candidate when its exact AABB/voxel overlap volume is lower than the current overlap.

Git: local commit pending on `codex/player-ground-collision`; no remote push requested.
