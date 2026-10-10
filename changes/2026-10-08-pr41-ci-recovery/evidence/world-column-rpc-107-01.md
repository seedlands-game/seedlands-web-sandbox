# PR41 phase107 — authorized asynchronous column inspection

Preregistered 2026-10-10 09:15:35 UTC; bounded implementation and verification window 18 minutes, stop after 120% (09:37:11 UTC). Source begins at `84b9347b678e02d69b95ea0d05d213248c19b120`; remote remains `dde3c593`.

Goal: expose the existing authoritative column source through World Harness `inspect`, using existing `world.chunk` read authorization. Do not add permissions, change input scheduling, materialize terrain, or adopt a lighting/presentation claim.

The persistent directory wait must occur outside the shared host operation queue. Final publication must reauthorize and reject replacement of outer world identity/runtime/epoch, including replacements whose internal kernel epoch number coincides. Preserve captured request coordinates against caller mutation.

Required counterexamples: a pending directory does not block host work; host mutation supersedes metadata; replacement world cannot publish old data; denied permission does not invoke source; malformed coordinates fail; normal metadata is detached and passes through existing browser RPC.

Validation: scoped tests, production and relevant test types, scoped lint/format, evidence freeze and path checks. Current CI409 is terminal failed; no full browser rerun is planned for this metadata prerequisite. Product Sky/R8/shader wiring and complete C0–C5 remain open. Budget last confirmed 08:26 UTC 78%, refreshing; stop near60%.

Status: implementation not started at preregistration. Results will be recorded below with exact command outcomes.

## Result at 09:25 UTC

Implemented the new `column-source` inspect request using the original world.chunk/read authorization. The authorized start captures the owner and starts the existing GameServer observation; directory I/O is awaited outside the shared queue. Publication reauthorizes and checks outer epoch, world ID and runtime identity. A later world revision returns unknown/superseded. Coordinates are captured and validated as exactly two safe integers. The existing Worker world RPC dispatch occurs before its hostOperation wrapper, so it does not introduce another queue around this wait. No new Worker message type or permission was added.

The new stdlib test has 14 cases: valid unseen column without terrain materialization, mutation-safe coordinates, five invalid coordinate shapes, self-scope denial without source invocation, host voxel edit and residency changes while directory I/O is pending, three outer-owner replacements, permission revoked during I/O, and directory exceptions. Current same-runtime/query observation remains point-in-time; no durable sky-clear cache or lighting/presentation proof is claimed.

Related real regression: the old World Logic boundary validated v1 while the production protocol/runtime uses v2. After changing only the fixture, the test still failed, demonstrating the production mismatch. The validator now references the existing LOGIC_PROTOCOL_VERSION; the original valid-batch acceptance assertion is retained and old v1 is explicitly rejected. No new protocol or permission is introduced. The previously untyped duplicate Browser Fake Worker was replaced with the existing fixture that implements the actual extended response port.

Passed:

- stdlib three files /40 cases (new fourteen, original source twenty, authorization six): `world-column-stdlib-final-107-07.log`.
- Web three files /18 cases, including original Harness session and Browser world proxy: `world-column-web-107-05.log`.
- production stdlib, root test types, actual Classic types and Web Svelte/tsc/tools types (0 Svelte errors/warnings).
- scoped lint, scoped formatting, path lint, frozen evidence 5/5 exact bytes, git diff check, CI selection17/17.
- Three Web files are registered in the original Classic headless/types selection; static selection guards cover them. New stdlib tests are collected by the original stdlib glob.

Retained failures: initial test-types fixture errors; initial Browser args-object assertion versus real args-array; old Logic v1 acceptance failure and subsequent v2 boundary rejection; initial Browser file526>500 lint failure and old FakeWorker response type failures. New focused column test is a separate file, shared existing FakeWorker replaces duplicate code; no max-lines exception or threshold change.

Not run: identified build, full headless/stdlib suite, original full browser/C0–C5, exact new SHA remote CI. Prior build48d, local directory1235PASS, native/visual and CI409 remain bound to their own sources. No new product-playability or performance claim. Phase105 blur A/A30.61% FAIL remains closed, A/B NOT_RUN, production blur unchanged; repeated snapshot candidate remains withdrawn after existing timing counterexamples. CI409 terminal failure is unchanged.

All private logs are under `/workspace/pr41-recovery-20261008-root-01`, with phase107 unique names. No push/merge/automerge/main/production deployment in this phase. Weekly quota last actual08:26 UTC78%, refresh pending; approximate60% stop line remains.
