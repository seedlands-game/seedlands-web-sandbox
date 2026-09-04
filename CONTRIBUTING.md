# Contributing to Seedlands Web Sandbox

Thank you for helping improve the sandbox. Contributions should stay honest about its scope: this repository is a playable Web voxel sandbox and technical foundation for Seedlands, not the complete game or a stable general-purpose engine.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues through the private process in [SECURITY.md](SECURITY.md), not through a public issue.

## Before starting

- Search existing issues and pull requests to avoid duplicate work.
- Open an issue before a large feature, public contract change, persistence migration, world-generation change, or rendering architecture change.
- Never commit `.env`, credentials, personal data, `node_modules/`, `dist/`, `coverage/`, `midscene_run/`, or local Harness output.
- New dependencies and assets must have a clear need and compatible license.

## Set up the project

Use Node.js 22.12 or newer and the pnpm version pinned by `package.json`:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

## Development contract

Changes that affect production code, behaviour, architecture, configuration, or test expectations start with a short Chinese change contract at `changes/<YYYY-MM-DD>-<kebab-name>/spec.md`. Define observable acceptance criteria and tests before implementation. Small, clear changes may proceed directly from RED to GREEN; breaking or exploratory changes require review of the exact spec SHA-256 before production implementation.

Keep these architecture boundaries intact:

- `src/world/` is pure deterministic logic with no DOM, PlayCanvas, worker globals, or reverse dependency on app/client/server code.
- `src/app/` owns browser startup, UI, input, and PlayCanvas lifecycle.
- `src/worker/` owns only worker entry points and transfer adaptation.
- World changes use the authoritative edit path; rendering uses chunk meshes rather than per-voxel entities.

Use kebab-case for new TypeScript, test, script, and change paths. Follow the repository's Prettier and ESLint configuration rather than introducing local formatting conventions.

## Testing

Run the checks relevant to your change, then run the static baseline and production build:

```bash
pnpm test
pnpm verify:static
pnpm build
```

For browser-visible or interaction changes, also run:

```bash
pnpm test:e2e:regression
```

Place delivery-specific Playwright tests under the active change's `e2e/` directory and Midscene YAML under its `midscene/` directory. Unit tests, static checks, builds, Playwright, performance samples, and visual-semantic checks are distinct evidence; report their actual results separately.

## Commits and pull requests

Use a short imperative commit header with one of these prefixes:

```text
feat: fix: refactor: test: docs: chore: ci: build:
```

Keep the header at or below 100 characters. A pull request should:

- explain the user-visible or architectural outcome;
- link the relevant issue and change contract;
- list the exact checks run and their results;
- call out known limitations, migrations, license changes, and security impact;
- avoid bundling unrelated cleanup; and
- include screenshots or visual evidence when presentation changes.

Pull requests run static verification, a production build, and deterministic Chromium regression tests. Deployment occurs only after a commit reaches `main` and all required jobs pass.

## Licensing contributions

Unless explicitly stated otherwise, intentionally submitted code and documentation contributions are provided under Apache License 2.0 as described in [LICENSE](LICENSE). Do not contribute material you do not have the right to license. Media assets require an explicit entry in [ASSETS.md](ASSETS.md); brand use remains governed by [TRADEMARKS.md](TRADEMARKS.md).
