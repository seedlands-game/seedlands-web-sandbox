# V1 门同轮 readiness snapshot 证据

阶段：`V1-DOOR-READINESS-SNAPSHOT-CLOSE-01`

状态：fixture、确定性与静态验证完成。Browser-14 原始失败证据保持在
`evidence/v2-canonical-browser-14/`，本阶段未修改或重跑。

## RED 与实现

RED 窗口 `v1-door-readiness-snapshot-close-01-red` 为 `1 failed / 1 passed`。序列中的旧 client-only 条件在
`physicsTick=102` 提前选择了 client 已越过出口、但同轮 `serverPlayerPosition.x=70.99` 尚未越过完整 voxel
`x=71` 边界的样本，而期望是最终 tick 105 的完整同轮样本。失败来自行为断言，不是 missing import 或 collection。

`matchesDoorRouteReadinessSnapshot` 复用既有 entry/exit 完整 voxel 边界 helper，并在一个 current snapshot 上联合
检查 client grounded/non-colliding、client/server 双位置、tick 严格前进与 ack 不倒退。`v1-slice.ts` 的 entry retreat
和 exit traverse 各保存对应 `walkTo` 返回 snapshot 为 baseline，再把 predicate 交给既有 `waitForSnapshot`；后续位置
和 readiness 断言只读其 structured-clone 返回对象，不再调用 `doorAuthorityObservation` 拼接第二次采样。
`ClassicSnapshot.serverPlayerPosition` 只是补齐生产 `HarnessSnapshot` 已实际返回的只读字段声明，没有新增 runtime 接口。

GREEN 窗口 `v1-door-readiness-snapshot-close-01-green` 为 `1 file / 3 tests PASS`。entry/exit 参数化序列依次拒绝
ready 旧 tick、fresh 未 ready、仅 client 越界、仅 server 越界和 ack 倒退，只接受 final
fresh+ready+双位置越界样本；最终 ack 与 baseline 相等，证明不要求无新 input 时伪造 ack `+1`。测试同时以对象同一性
和全值相等确认被选择的是该最终样本，而不是跨样本拼接字段。

## 验证

- 受影响闭包 `v1-door-readiness-snapshot-close-01-affected`：`5 files / 41 tests PASS`，包含新 readiness、
  既有 door collision/entry、Browser-13 eye/view 与三个 `.06/.08` 到达域 strict exit-face 收敛、target aim 和
  route progress；`maxWorkers=1`。
- `v1-door-readiness-snapshot-close-01-classic-types`：Classic test types PASS。
- `v1-door-readiness-snapshot-close-01-root-types`：root test types PASS。
- `v1-door-readiness-snapshot-close-01-eslint`：4 个改动 TS 的定向 ESLint PASS。
- `v1-door-readiness-snapshot-close-01-format-write` 与 `v1-door-readiness-snapshot-close-01-static`：7 个 TS/MD
  的 Prettier、tracked 与新增 no-index scoped diff PASS。

以上命令均使用默认 benchmark machine lock，Vitest 为单 worker；原始 stdout/window 保存在
`evidence/v1-door-readiness-snapshot-close-01/`。

## 证据边界

- 本文件只记录 fixture 确定性与静态结果，不把它表述为 Browser-13 lower exit-face 已关闭或 Browser-15 已通过。
- Browser-14 已知事实是不同时间的两个 snapshot 之间出现 readiness 瞬时变化；失败轮具体 false 字段未知。
- 新 helper 只对一个 snapshot 内的 client readiness、client position、server position 和 Authority tick/ack 投影
  联合判定，不声称跨 owner 原子性或独立 Authority readiness。
- 没有运行 Browser/build/Cua/devserver/CI/Git/index/push/deploy。Browser-13 lower exit-face 仍只有确定性证明，
  Browser-14 lower exit-face 未触达；真实产品复验必须等待 root 另行授权的新 identity Browser-15。

## 预算与长期文档

预算上限 3 小时（硬上限 6 小时），传统工作量约 0.25-0.5 PD。AI credits、API 等价费用、费率、额度分母与
占比 unknown。此 fixture 修复不改变长期 owner、公开协议或架构，因此长期 docs baseline 不更新。
