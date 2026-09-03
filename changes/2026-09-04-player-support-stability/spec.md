# Player Support Stability

**Status:** Superseded by `2026-09-04-center-of-mass-grounding`

Follow-up diagnosis showed that the 50% area threshold did not model ordinary downward excavation: removing the center-targeted voxel at an integer player coordinate leaves 75% neighboring overlap and still re-arms `onGround`. Historical validation below remains factual for the narrower one-corner fixture, but that fixture was not sufficient acceptance evidence for the reported bug.

## Context & Goal

Jump-building or quickly excavating below the player can leave only a small corner of a voxel under the player footprint. Treating any foot-plane contact as ground keeps `onGround` true in mid-air; moving with WASD is then required to leave that corner, and holding jump repeatedly re-arms a jump.

Complete when a partial corner cannot support the player or re-arm jumping, while a full flat surface remains walkable.

## Scope & Non-goals

- In scope: distinguish any-contact head blocking from minimum-area foot support, plus a Chromium regression fixture.
- Non-goals: step climbing, crouching, variable player dimensions, or replacing the axis-separated controller.

## Decisions

Direct implementation: calculate the exact horizontal overlap area between the player footprint and each solid voxel at the crossed foot plane. Landing requires at least half of the square footprint area to be supported; upward collision remains any-contact. This prevents a single corner from anchoring the player without changing collision width or flat-ground movement.

## Behaviour

- Given only one of four equal footprint quadrants is solid below the player, When falling without movement input, Then the player continues downward and `onGround` stays false.
- Given the same partial support, When Space is pressed while falling, Then the player continues falling instead of jumping.
- Given a full flat platform, When holding a movement key, Then the player remains grounded and moves horizontally.

## Acceptance & Evidence

- [x] Deterministic voxel checks and production build pass.
- [x] Chromium harness verifies both flat-platform movement and falling/jump rejection from a one-corner support fixture.
- [x] `git diff --check` passes.

## Tasks & Current State

1. [done] Identify false `onGround` state caused by any-corner foot contact.
2. [done] Implement area-based foot support and browser fixture.
3. [done] Run validation and record evidence.

## Delivery Snapshot

Changed paths: `src/main.ts`, `scripts/browser-harness.mjs`, and this change record.

Validation: `CI=true corepack pnpm test` passed; `CI=true corepack pnpm build` passed; `git diff --check` passed; `CI=true corepack pnpm harness:e2e` passed. Chromium stages Load, Input, Player, FlatMovement, PartialSupport, Interaction, Streaming, MacroMap, and Persistence all passed. `PartialSupport` leaves only one of four equal player-footprint quadrants at y=56, verifies at least 0.5 world units of falling without WASD, then holds Space and verifies continuing descent rather than a re-armed jump.

Known limitation: the controller remains axis-separated and does not implement step climbing or swept-capsule collision.

Git: implementation commit `11da248` on `codex/player-ground-collision`; no remote push requested.
