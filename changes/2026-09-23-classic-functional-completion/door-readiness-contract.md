# V1 门同轮 readiness snapshot 合同

阶段：`V1-DOOR-READINESS-SNAPSHOT-CLOSE-01`

状态：待完成 fixture、确定性与静态验证；Browser-14 保持 FAIL，Browser-15 未授权。

## Browser-14 RED

- 唯一窗口 `f7a53699-300d-429c-a308-8c48399036df` 在 `v1-slice.ts:298` 失败。此前 `walkTo` 已返回一个
  fresh、`onGround && !colliding` 的 snapshot，fixture 随即调用 `doorAuthorityObservation` 取得另一个 snapshot，
  再断言该组合条件。
- `doorAuthorityObservation` 仅把 position 取自同轮 `serverPlayerPosition`；`onGround/colliding` 仍是 client 字段，
  不能称为 Authority readiness。trace 没有序列化失败轮中哪个布尔为 false；稍后 attachment 的 true/false 组合
  不能倒填失败轮。
- 失败轮前已经完成真实穿门，但 upper 再关闭、lower exit-face aim/click 均未触达；Browser-13 根因未获产品复验，
  V2 全部 `NOT REACHED`。

## 可验证行为

1. entry retreat 与 exit traverse 各自先保存本轮 `walkTo` 返回的 snapshot 作为 baseline；不得把不同路线或旧轮次
   的 tick/ack 当 baseline。
2. 复用既有 `waitForSnapshot` 的 20 秒上限，等待一个同时满足全部条件并由该函数 structured-clone 返回的 snapshot：
   client `onGround && !colliding`；client `player` 与同轮 `serverPlayerPosition` 都严格越过 entry/exit 对应的完整门
   target voxel 边界；`authority.physicsTick > baseline.authority.physicsTick`；
   `authority.acknowledgedInputSequence >= baseline.authority.acknowledgedInputSequence`。不要求没有新输入时 ack `+1`。
3. 匹配后所有 readiness、client position 与 server position 断言只读该匹配 snapshot；不得立即再采样并把字段拼成
   单次证据。单 snapshot 只表示一次 Harness 观察中的 client/server 投影，不表示两个 owner 的原子事务，也不提供
   独立 Authority grounded/colliding。
4. 确定性序列至少包含 ready 但旧 tick、fresh 但未 ready、仅 client 越界、仅 server 越界、ack 倒退，以及最终
   fresh+ready+双位置越界。只有最终样本匹配，且返回对象保留该样本的同一组字段；entry 与 exit 使用同一合同。
5. 既有 Browser-13 eye/view、三个 `.06/.08` 到达域 position 和 strict lower+exit adjacent 180 次内收敛测试保持。

## 范围、预算与停止线

- 只修改 `v1-slice.ts`、同职责 `door-collision-oracle.ts`、必要定向测试和 `harness.ts` 的 `ClassicSnapshot`
  只读字段声明；不修改 `snapshot`、`walkTo`、`waitForSnapshot` 运行逻辑、生产 observability/public protocol、
  route/aim/mouse/scenario 或 V2 fixture。
- 不增加 720 秒 canonical、45 秒 walk、20 秒 polling 或 180 次 aim 预算；不 sleep、fallback、随机路线或重试。
- 原 closed probe、upper/lower/exit adjacent、pair/open mesh/collision/fresh ack、V1 Media、V2 与 C0-C5 顺序均保留。
- 本阶段上限 3 小时（硬上限 6 小时），传统工作量约 0.25-0.5 PD；AI credits、API 等价费用、费率、额度分母
  与占比 unknown，不伪造。
- 本片不改变长期 owner、公开协议或架构，长期 docs baseline 不更新。确定性/static GREEN 不是 Browser GREEN；
  Browser-15 必须由 root 在新 identity 后另行授权。
