# Player Ground Collision Consistency

**Status:** Integrated into the current quality architecture

## Context & Goal

After the prior false-air-support fix, a player can be grounded using only the foot-center voxel while horizontal collision still checks the full player footprint. On a flat voxel platform that crosses grid cells, these disagree and movement can be blocked.

Complete when a grounded player can move across a flat voxel surface and downward support uses the same footprint as the body collision boundary.

## Scope & Non-goals

- In scope: align downward support with the existing foot-plane footprint test and add a Chromium regression fixture.
- Non-goals: change player dimensions, add step climbing, or replace the axis-separated controller.

## Decisions

Direct implementation: retain separated vertical/horizontal collision, but use `collidesAtY()` for both upward head checks and downward foot support. It samples only the horizontal footprint at the crossed plane, avoiding full-body side-contact grounding while matching the collision box used for movement. Centralize the player dimensions and inset the horizontal collision sample by a tiny epsilon, so a floating-point position exactly on a voxel face is not treated as overlap.

## Behaviour

- Given a player standing on a flat solid voxel platform spanning multiple grid cells, When holding a movement key, Then the player changes horizontal position while remaining at the same grounded height.
- Given downward motion, When the player footprint reaches solid voxels, Then vertical velocity stops and grounded state becomes true.
- Given upward motion, When the head plane reaches solid voxels, Then vertical velocity stops without setting grounded state.

## Acceptance & Evidence

- [x] Deterministic voxel checks and production build pass.
- [x] Chromium harness constructs a flat platform, walks across it, and verifies displacement and stable grounded height.
- [x] `git diff --check` passes.

## Tasks & Current State

1. [done] Identify the center-foot versus full-footprint collision mismatch.
2. [done] Align downward support and add a flat-platform browser regression.
3. [done] Run validation and record evidence.

## Delivery Snapshot

Changed paths after rebase: `src/app/main.ts`, `tests/e2e/support/harness.ts`, `tests/e2e/regression/world-play.spec.ts`, and this change record. The old `src/main.ts` and `scripts/browser-harness.mjs` paths are intentionally not restored.

Current validation: `corepack pnpm verify:static`, `corepack pnpm build`, and `corepack pnpm harness` passed. The Playwright flat-platform regression constructs its world through the production `World.edit()` path, uses real Pointer Lock and keyboard input, and waits for observable position/grounding state rather than a fixed delay.

Known limitation: the controller is still axis-separated and does not implement step climbing or swept-capsule collision.

Git: rebased implementation commit `429a673` on `codex/player-ground-collision-integration`; no remote push requested.
