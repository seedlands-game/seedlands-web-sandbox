# Seedlands Web Sandbox

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI and Pages](https://github.com/seedlands-game/seedlands-web-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/seedlands-game/seedlands-web-sandbox/actions/workflows/ci.yml)

An experimental, playable browser voxel sandbox and technical foundation for the wider **Seedlands** world project.

This repository is not the complete Seedlands game and is not presented as a general-purpose Seedlands engine. It is a self-contained Web prototype for deterministic terrain, chunk streaming, authoritative world state, editable voxels, persistence, and browser rendering.

The deployment target is [seedlands-game.github.io/seedlands-web-sandbox](https://seedlands-game.github.io/seedlands-web-sandbox/). Once the repository is public and GitHub Pages is enabled, every successful `main` build is deployed automatically. Public builds show their short commit hash and world generator version in the lower-right corner.

## Current status

The sandbox is an early technical prototype. Its current capabilities include:

- Deterministic macro geography, climate, biomes, rivers, lakes, trees, and terrain. The same `seed + generatorVersion` produces the same base world regardless of chunk load order.
- Compact `32³` `Uint16Array` chunks and chunk-level greedy meshes rather than one entity or draw call per voxel.
- Chunk meshes are submitted in opaque, cutout, and transparent render-category batches. Voxel-specific GLSL/WGSL chunks sample a texture array, while Float16 UVs and safe Uint16 indices reduce mesh transfer size.
- Player-centred chunk streaming with bounded CPU/GPU retention.
- An in-process authoritative `GameServer` for chunks, player state, entities, and world time.
- First-person movement, collision, jumping, timed voxel harvesting, item drops, pickup, and inventory-backed placement.
- A minimal survival loop with health, hunger, 24 inventory slots, an 8-slot hotbar, food, three recipes, tools, combat, death drops, and respawning.
- A deterministic starter ecology with a passive grazer, a night-only hostile, a scheduled settler, nearby POIs, bounded voxel ground navigation, and inspectable asynchronous actions.
- Browser persistence for the seed, world clock, player state, gameplay entities, actor needs/actions, POIs, inventory, and materialized chunk snapshots.
- A day/night environment, transparent water, quality presets, a macro world map, and a retained Svelte 5 HUD.

Not yet implemented are the defining systems of the full Seedlands vision: essence and magic, autonomous NPC societies, persistent historical events, longevity and reincarnation, or the content of the six realms.

## Quick start

Requirements: Node.js 22.12 or newer and Corepack.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. To create and preview a production build:

```bash
pnpm build
pnpm preview
```

No private `.env` file is required to run or build the sandbox.

## Controls

| Input           | Action                                          |
| --------------- | ----------------------------------------------- |
| Click the scene | Capture the pointer and look around             |
| WASD            | Move                                            |
| Mouse           | Look                                            |
| Space           | Jump                                            |
| Hold left click | Harvest the targeted voxel or attack a creature |
| Right click     | Place the selected block item                   |
| 1–8             | Select a hotbar slot                            |
| E               | Toggle inventory and crafting                   |
| M               | Toggle the macro world map                      |
| F3              | Toggle the debug HUD                            |
| F4              | Toggle the server debug command shell           |
| P               | Pause or resume world time                      |
| [ / ]           | Move world time backward or forward one hour    |
| T               | Cycle 1×, 20×, and 100× time speed              |
| Esc             | Release the pointer                             |

## Server command debugging

Press F4 after entering a world to open the compact debug shell. World commands include `/setblock`, `/fill`, `/tp`, `/time get`, `/time set`, `/seed`, `/save`, `/inspect voxel`, and `/inspect chunk`. Gameplay commands include `/inventory`, `/give`, `/damage`, `/heal`, `/spawnitem`, `/spawn creature`, `/craft`, `/break`, `/cancelbreak`, `/pickup`, `/drop`, `/place`, `/use`, `/attack`, `/respawn`, `/tick`, and `/nearby`. Actor debugging adds `/summon`, `/observe`, `/entity action`, `/entity move`, `/entity stop`, `/path`, and `/poi nearby`; invalid arguments return usage details in the shell. The shell releases pointer lock while open; press Esc to close it. Its log text can be selected and copied with native browser controls, and the input accepts normal paste operations. Use Up and Down to browse the latest 20 submitted commands and return to an unfinished draft.

The same structured command boundary is available without PlayCanvas, Canvas, or the DOM:

```bash
pnpm server:headless -- --seed my-debug-world
```

The first headless harness uses in-process memory persistence. `/save` exercises both chunk and gameplay snapshot persistence and supports reload tests within the process; it does not create a durable world file after the process exits.

## Architecture

`GameServer.editBatch()` is the authoritative transaction boundary for batched world mutations. The browser runtime is split by responsibility across startup, player control, rendering adapters, world streaming, environment, HUD, and persistence modules. One Svelte 5 root owns the runtime UI. Game code publishes small, independently subscribed Shell, HUD, Interaction, and Debug projections through `UiBridge`; components send intents back through an action port and never own authoritative World or Server state.

```text
src/app/       Browser startup, PlayCanvas lifecycle, retained UI bridge, input, and styles
src/client/    Browser persistence and client-side adapters
src/server/    Authoritative world, entity, clock, and snapshot interfaces
src/world/     Deterministic world, voxel, mesh, coordinate, and save logic
src/worker/    Experimental worker entry point and transfer adapter
tests/         Unit, architecture, and long-lived browser regression tests
changes/       Change contracts and their delivery-specific evidence
scripts/       Local harness and engineering scripts
```

`src/world/` is deliberately independent of the DOM, PlayCanvas, and worker globals. World edits pass through the authoritative world path, and rendering operates on optimized chunk meshes.

## Verification

```bash
pnpm test
pnpm verify:static
pnpm build
pnpm test:e2e:regression
```

These commands provide different evidence. Unit tests cover deterministic logic; static verification covers formatting, linting, path rules, coverage, and TypeScript; the production build proves bundling; Playwright covers deterministic browser behaviour. Visual semantics are evaluated separately with change-scoped Midscene flows.

The architecture lint also limits JavaScript and TypeScript modules to 500 effective lines, excluding blank lines and comments, so responsibilities continue to be split instead of accumulating in a new monolith.

For the complete development workflow, testing layers, and pull request expectations, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Relationship to Seedlands

Seedlands is intended as a living sword-and-magic open world governed by unified natural laws, autonomous inhabitants, persistent consequences, and lives that can continue through reincarnation. Voxels are one material and interaction language inside that vision, not its product definition.

This repository may remain useful independently as an open Web sandbox even if the wider game later moves to dedicated clients and servers.

## Known limitations

- Water is rendered but not simulated as pressure, flow, or waterfalls.
- There are no caves, propagated voxel lighting, mobile touch controls, floating origin, or distant-world LOD yet.
- Browser persistence favours a simple prototype deployment rather than large-world storage.
- Creature and settler behaviour is a bounded deterministic foundation; there is no dialogue, trading, reproduction, crowd avoidance, or full ecology simulation yet.
- The current vertical streaming range is sized for this prototype's terrain.
- The main JavaScript bundle is large and has not yet been split into lazy-loaded runtime chunks.

## Contributing and security

Contributions are welcome within the repository's current scope. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a pull request.

Playwright uses port 4173 by default; parallel worktrees can set `SEEDLANDS_E2E_PORT` to avoid port collisions.

Please do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) instead.

## Licensing

- Source code and repository documentation: [Apache License 2.0](LICENSE)
- The voxel atlas: see [ASSETS.md](ASSETS.md) for its separate CC BY 4.0 terms and attribution
- The Seedlands name and brand identity: see [TRADEMARKS.md](TRADEMARKS.md)
- Third-party dependencies remain under their respective licenses
