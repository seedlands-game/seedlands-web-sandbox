# Living NPC round 9 browser pause fix

## 变更

- `Game.setPaused()` 在更新本地暂停标志后立即调用 `CompanionSession.setPaused()`；该方法仅转发到当前 `CharacterControllerBridge`。
- `CharacterControllerBridge.setPaused()` 在连接 ready 后幂等发送 `control/pause` 或 `control/resume`。ready 前不提前更新“已发送暂停”状态，因此首次连接时已经暂停仍会在 ready 的初始 poll 中发出 pause。
- Bridge 收到 intent 时在调用 Authority 端口前重新读取 Game 的实时暂停状态。若已暂停，则不调用 `port.intent`，返回 requestId 对应的 rejected receipt，reason 为 `WORLD_PAUSED`。
- memory 提案没有被暂停门禁拦截，仍交给 Authority 并回传 accepted/rejected receipt，以完成已经发出的压缩候选对账。
- 新增 fake-clock 回归，覆盖 ready 前已暂停、模型 thinking 期间 500ms poll 前同步暂停、迟到 intent 不写目标/发言、memory ACK 路径、同步 resume 和恢复观察；新增 Game 单元回归覆盖尚无 world runtime 时的同步 Companion 通知。

## 验证

RED（生产修复前）：

```text
./node_modules/.bin/vitest run tests/client/character-controller-bridge.test.ts tests/app/game-companion-pause.test.ts
2 failed | 6 passed
- bridge.setPaused is not a function
- expected companion.setPaused(true), received 0 calls
```

GREEN：

```text
./node_modules/.bin/vitest run tests/client/character-controller-bridge.test.ts tests/app/game-companion-pause.test.ts tests/app/companion-session.test.ts
Test Files 3 passed (3)
Tests 9 passed (9)
```

Additional deterministic checks:

- `pnpm --filter @seedlands/web typecheck`: PASS; svelte-check 0 errors / 0 warnings, app TypeScript checks passed.
- `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit`: PASS.
- Focused ESLint over 5 changed source/test files: PASS.
- Focused Prettier check over 5 changed source/test files: PASS.
- `git diff --check` for authorized source/test paths: PASS.

No provider or Browser run was performed under this contract. Root owns the real Browser pause journey and global gates.

## 风险

- The browser gate prevents a host intent whose Bridge execution begins while Game is paused from reaching Authority. A request already posted to Authority before `Game.setPaused(true)` began crossed the boundary while the world was still unpaused and is outside this late-arrival case.
- Sending pause can abort or suppress host work, but any provider request cost already incurred before the host processes pause is not refunded and is not claimed as saved.
- `WORLD_PAUSED` is carried in the existing bounded receipt reason string; no core or cognition protocol schema changed.
- Memory commits remain Authority-validated during pause by design so an emitted compression proposal cannot strand its pending ACK.

## 实际成本

- Agent wall time: approximately 0.17 hours.
- Provider/model calls: 0.
- Browser runs: 0.
- Dependency installs: 0.
- Scope expansion: only `CompanionSession` forwarding file added by superseding contract round9-pause-fix-v2; no other scope changes.
