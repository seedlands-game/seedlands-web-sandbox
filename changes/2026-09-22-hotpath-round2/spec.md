# 热路径第二轮：统计、容量预检、碰撞分配

状态：Delivered（性能候选未采用，Classic v2 场景合同交付）。Agile 局部候选，用户已明确授权实施与真实实验。基线 6b82a5d2，独立工作区，不包含上一轮尚未合并的配方优化，不触碰其他会话工作。

## 目标与边界

M：减少常规 view 中昂贵 snapshotBytes 统计，保留 checkpoint prepare/drain 的执行语义与诊断可信度；若无法不改变公开合同地安全解耦，记录证据并拒绝该候选。
P：容量预检只取得所需实体计数，避免实体投影分配；保持物理、拾取、恢复、gameplay 提交上界、异常与状态一致。
C：减少碰撞查询临时分配；结果内容、顺序、未知区块阻挡/请求、revision、保留旧结果与嵌套查询不变。禁止泄漏可变共享 scratch；不改物理公开 API 或世界生成。

### M 候选边界与拒绝记录

`snapshotBytes` 仍表示本次读取时完整 GameplaySnapshot JSON 的精确 UTF-8 字节数；常规 view 继续创建快照，因此 checkpoint 的两轮 `prepareSnapshot()/drain()` 语义、异常与新鲜度不变。拒绝缓存、降低采样频率或仅按 `gameplayRevision` 复用：`EnvironmentRuntime.ignite()` 会改变 checkpoint 中的 fires，却不调用 `GameplayRuntime.touch()`；而完整快照还包含 simulation、authority、environment 和各 gameplay module，不能由 EntityStore 计数证明新鲜。

唯一实现候选只替换字节计数：在 `JSON.stringify(snapshot)` 之后按 UTF-16 code unit 计算标准 UTF-8 长度，覆盖合法代理对和孤立代理的 U+FFFD 替换语义，避免 `TextEncoder.encode()` 为仅取 `byteLength` 分配临时 `Uint8Array`。它不移除 snapshot 或 JSON 分配，是否采用仍由预注册 A/B 判定。

## RED 与功能验证

先加入能暴露候选错误的定向测试再实施。M 覆盖重复读取、状态改变、prepare/drain、存档恢复；P 与原查询计数差分并覆盖创建/删除/恢复/实体类型变化；C 覆盖旧结果保留、交错查询、编辑与 revision、未知区块和异形碰撞。使用已有 stdlib 测试与静态检查。若方案需要公开协议变化，先停止该方案，选择合同内候选或记录未采用。

## 预注册实验

所有构建、重测试和性能采样通过默认机器锁 /tmp/seedlands-benchmark-reservation；不改锁目录，不抢锁。复用唯一生产 Classic C0–C5 和已有 profiler，不创造替代浏览器流程。固定 seed、分辨率、worker 数和观测器。先控制 A/A/A；每个独立候选 A/B/B/A；通过项共同组成 B 再运行组合 A/B/B/A。每次完整退出，保存源码、产物、窗口与原始样本，不挑绿重跑。

M/P 主指标 Authority 活动 CPU；C 主指标 Main 活动 CPU。采样口径同前轮（2000us CPU、65536byte heap；C1 后 C4 前完整段；包括 GC）；改善需大于 max(5%,2×A/A相对极差)。次指标分配率；否决为 frame p95、chunk p95、合计 Main+Authority CPU 任一回归超过 max(10%,2×对应A/A噪声)，或正确性失败。组合主指标合计 CPU 同门槛。门槛不因结果改变；主指标噪声超过20%则本轮无可靠采用依据，停止计时优化判定。没有确定收益保留 control，撤回生产候选，留补丁和失败结论。一次有界组合消融最多3项；仍不清楚则不采用组合。

功能/静态通过不当作性能提升。最终通过项恢复默认无 profiler 配置，构建并执行生产旅程，记录 identity。CPU 节省不等于帧率改善；input-to-visible/精确拷贝 bytes 未采集则明确说明。

## 工作量与预算

正常传统4PD、保守6PD；AI并行3个Terra/high有界worker，主线程组织实验，预计连续墙钟2–4h，保守4h×120%=4.8h；不创建Goal。单线程预计4–6h。credits、token分配、API费率和账户剩余额度无可靠归因，均unknown，不推造费用；本轮不购买额度。超过阶段预算保存checkpoint并重估。分项结果和实际墙钟在交付回填。

## 任务

- [x] 三个候选 RED/实现/功能验证
- [x] 固定新基线与 A/A
- [x] 按预注册噪声停止线终止分项采用判定
- [x] 撤回全部未获性能证据的生产候选，不执行组合
- [ ] 报告、提交、PR远端读回；不自动合并

长期 docs baseline 不预先变更：预期为实现内部优化，若实验发现可复用合同再裁决。

## 基线阻塞与场景合同提案（待用户选择）

首次新版本控制样本 hotpath-r2-aa1 在 C0 初态创建失败：`WORLD_REQUEST_INVALID: Unknown actor profile: settler`。6b82a5d2 的视觉改版 spec 第46行已明确退休 settler，旧 C0–C5 不能证明新版本通过；本次不恢复已退出产品内容、不更改失败为成功、不进入 A/B。

建议当前产品新场景 v2：保持 seed、生成器、图形/worker配置、采集/制作/战斗/建造/往返四个Chunk中心/资源界限/存档恢复与恢复后真实操作；移除不属于现行产品的 settler 创建、专属活动和存档断言，明确 NPC 能力不在新旅程覆盖范围。采用新 scenarioId，旧数据不可直接比较。场景改动对 A 与所有 B 完全相同，重新采 A/A/A。用户也可选择仅在0759202旧版探索，结论不能授权当前6b82a5d2生产采用。

C 具体候选只缓存静态、有限 voxel ID 的局部形状定义，最终 Collider/AABB 和每次结果仍独立；未知请求 Set 延迟创建。P 直接遍历权威 ECS membership 统计非station与world-item数，不维护可能漂移的增量计数器；旧 port 保持查询 fallback。

当前静态证据：stdlib99文件596测试PASS；首轮全仓typecheck唯一失败为新增碰撞测试字面量类型，修正后tsconfig.test单独PASS。初次ESLint揭示两处文件行数和测试prefer-const，修复中。首个control构建因pnpm11不接受软链接node_modules失败，改为独立offline/frozen-lockfile安装后build PASS，失败日志保留。

### 场景修订已授权

用户已选择「修订当前场景后继续实验」。按上述当前 Classic 场景合同实施；新 A/A 样本使用不同 runId，不覆盖失败 hotpath-r2-aa1。不恢复 settler、不沿用旧场景性能基线，不声称新场景覆盖 NPC 专属行为。新场景代码与配置在 control 与所有候选完全一致。

## 暂停与恢复记录

用户曾明确要求停止性能优化，让位体验优化；当时状态为 STOPPED_BY_USER，未继续实验、提交或推送。2026-09-22 用户重新指示“继续干活”，本轮恢复。三个候选与场景修订仍在独立工作区，尚无有效 A/A 或 A/B，不采纳任何生产候选。v1 control 因退休 NPC 初始化失败；v2 第一次 control 在新添的玩家恢复坐标断言失败（恢复后重力使 Y 从约60.77正常落至60.00，X/Z一致）。恢复后的合同保留玩家 ID、生命、背包、X/Z 与有限 Y；不把实时物理继续运行后的 Y 完全相等误作持久化要求。两个失败样本继续保留，不计入性能结果。
