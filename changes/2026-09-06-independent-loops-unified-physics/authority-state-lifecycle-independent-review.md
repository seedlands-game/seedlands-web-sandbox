# Authority 状态生命周期独立审查

## 审查身份与绑定

- 请求模型：Sol
- 请求 effort：xhigh
- 审查者角色：非实现作者，只读反例审查
- 已批准合同：`changes/2026-09-06-independent-loops-unified-physics/spec.md`
- 合同 SHA-256：`c14711d82070e0b9c255eda0bfc5b2bbd134d130a8c45dacf662480e9b953512`
- 首轮审查源：`e624924`（服务端碰撞增量）、`15d01cc`（canonical Chunk 驻留）、`5904dc0`（玩法未知 Chunk）、`56f9dee`（客户端碰撞 revision 水位后继）以及 `617e3fc`（驻留观测与 streaming 重试）
- 最终复验源：`13508a3`（卸载代际与 commit 独立消费）、`26c2c85`、`58f19d0`、`2a0b55a`、`d65b2b5`（异步 durable-first 准备与 exact identity）、`2ca311c`、`408cb68`、`f077e35`（流体候选有界复核）、`f28bb75`、`3f83696`（碰撞 commit 缺口有界重同步）、`960ec56`、`d7a89e5`、`6b83fce`（结构提交后的身体恢复）

## 实际证据

在 `56f9dee` 的干净归档副本 `/tmp/seedlands-review-56f9dee-2` 中执行以下定向用例，5 个文件、17 项通过：

```text
tests/server/world-collision-delta.test.ts
tests/server/chunk-residency.test.ts
tests/server/gameplay-unknown-chunk.test.ts
tests/client/authority-collision-mirror.test.ts
tests/client/authority-collision-mirror-client.test.ts
```

源码检查确认：单格、一般批量、唯一坐标缓冲批量和流体候选都按 Chunk 生成连续 `previousRevision → revision`；体素事务发送最终 `voxel` 以及由最终体素确定的 `0x88 | 0`，流体候选发送通过 read-set/cell-conflict 校验的最终原始 `fluid` 字节。玩法的放置、破坏、拾取、玩家攻击和 Actor LOS 在未知 Chunk 上均保守失败；浏览器调度器与 headless `Set` 会对重复未知请求去重。dirty Chunk 在保存失败后仍留在 canonical Map；驱逐仅接受已 ACK、revision 未变化、clean 且未 pin 的同一对象。

首轮额外反例发现六项未通过边界：

1. `/tmp/seedlands-collision-release.test.ts`：在途 baseline 开始后卸载 exact Chunk，再让旧权威接纳回执成功。当前旧回执会把已卸载 Chunk 重新写入碰撞缓存。实际 `chunks.has(key) === true`，期望 `false`。
2. `/tmp/seedlands-collision-reordered-snapshot.test.ts`：较新但无 commit 的快照先到，唯一携带 `revision 4 → 5` delta 的旧快照后到。当前快照顺序门连同 commit 一起丢弃，最终仍为 Air/revision 4，且没有 `onCommit`；期望仅拒绝旧快照状态，并对 commit 流幂等消费到 Stone/revision 5。
3. `/tmp/seedlands-residency-reload.test.ts` 与 `/tmp/seedlands-authority-edit-unknown.test.ts`：clean Chunk 保存并驱逐后，浏览器 persistence 预取缓存处于“尚未加载”状态；同步 `getChunk/edit` 把缓存 miss 当成耐久不存在并重新生成基础 Chunk，丢失已保存编辑。同一入口也允许 `AuthorityRuntime.editWorld` 在未知 Chunk 内同步运行 `makeChunk`，单格反例使 resident 从 0 增至 1，且不发未知请求；跨 Chunk batch 会把多次生成放入一次 Authority 事务。
4. `/tmp/seedlands-streaming-retry-empty.test.ts`：`617e3fc` 只在 repository 已有可见 Chunk 时尊重 100 ms 至 2 s 的 admission 退避；零可见 Chunk 的背压场景会在同一中心每帧重派全部 needs。1 ms 后请求次数由 2 增至 4，期望仍为 2。
5. `/tmp/seedlands-fluid-candidate-validation.test.ts`：把合法 lease 的计算结果替换为同一已读 Chunk 内、但远离 lease frontier 的写入，并给出 `voxel=65535`、`fluid=255`。Authority 当前只校验 read-set revision 与调用方自报的旧格值，结果仍返回 `accepted: true` 并进入 apply。Worker 因此可写入不属于已租派生结果的任意已加载格和非法最终字节；`collisionDelta` 在 typed array 截断前还会原样发布这些非法 number，服务端数组与客户端镜像可产生不同值。

六个 `/tmp` 反例均使用：

```text
pnpm exec vitest run --root /tmp <absolute-test-path>
```

并稳定得到 1 项 RED；它们未修改生产源码或仓库测试。

`13508a3` 对前两项客户端碰撞问题完成后继修复。独立重跑 `/tmp/seedlands-collision-release.test.ts` 与 `/tmp/seedlands-collision-reordered-snapshot.test.ts` 均转为 GREEN；再运行 `tests/client/authority-collision-mirror.test.ts`、`tests/client/authority-collision-mirror-client.test.ts`、`tests/client/authority-transport.test.ts`，3 个文件、15 项通过。源码复核确认 baseline 接纳绑定加载代际，release 增加墓碑并拒绝旧代际回执；commit 流在快照状态顺序门前按 `worldRevision` 幂等消费，重复 commit 只发布一次 `onCommit`，旧快照本体仍会被拒绝。该修复未放宽 Chunk revision 连续性。

后继复验补充了两项独立 RED：`/tmp/seedlands-collision-commit-gap-memory.test.ts` 证明永久缺少一个 world revision 时重排集合会无界增长；`/tmp/seedlands-recovery-priority-overwrite.test.ts` 证明自动外部几何恢复会用 `maxDistance=2` 覆盖同一身体已排队的 `legacy-restore,maxDistance=8`，使本可恢复的密实体变成 `blocked`。`f28bb75`、`3f83696` 与 `6b83fce` 修复后，两项反例均转为 GREEN。

最终定向证据如下：

- canonical durable-first：原 `/tmp/seedlands-residency-reload.test.ts`、`/tmp/seedlands-authority-edit-unknown.test.ts`、`/tmp/seedlands-streaming-retry-empty.test.ts`、`/tmp/seedlands-mutation-mismatched-result.test.ts` 共 4 项通过；`authority-canonical-preparation`、`authority-mutation-preparation`、`chunk-residency`、`authority-runtime` 共 4 个文件 22 项通过。
- 碰撞提交：缺口有界反例通过；`authority-collision-mirror` 与客户端接线 2 个文件 13 项通过。超过 2048 个乱序提交时推进 retired 高水位、清空有界集合并让已加载碰撞镜像按代际失效；触发提交与全量重同步命中同一 key 时只请求一次基线，低于高水位的迟到或重复提交不会再发布 `onCommit`。
- 流体候选：5 个目标文件 49 项通过。Authority 只做租约范围、只读 revision、格值、唯一性、合法最终体素/流体字节、source 保护和 frontier 扩展的有界验证，不宣称重新执行或证明完整传播算法。
- 身体恢复：`authority-entity-physics` 与 `authority-runtime` 2 个文件 17 项通过；另以 `/tmp/seedlands-recovery-nonsolid.test.ts` 验证最终 Air、Water 两项均不进入恢复队列。direct edit、玩法 action、流体和命令路径各只记录一次结构提交；`advance-gameplay` 在权威玩法端记录恢复后，只把已取出的 commit 原样保留给外发，不重复记录。相同身体合并时保留最大距离和更高优先原因，每步仍只处理 4 项。

## 风险与结论

最终批准上述 A1/A7/A12 状态生命周期模块准入当前已批准合同。浏览器和 headless 生产构造均提供外部 unknown 计算入口，因此先异步检查持久化，再仅在明确 missing 时请求 General Worker；无外部计算端口的纯本地 `AuthorityRuntime` 保留兼容性同步基础生成，但仍先检查持久化。存储异常不降级成 procedural missing，同 key 请求合并且总量上限为 2048；迟到 revision 0 结果不能覆盖已恢复 Chunk。

剩余风险均为有界取舍：碰撞 commit 长期缺口超过窗口时会丢弃全部已加载碰撞镜像并重新取基线，代价高但 fail closed；结构提交的总体 bounds 是保守近似，稀疏大批量编辑可能排入无需移动的身体，实际恢复仍先复核真实静态重叠，队列最多 512 且每步 4 项；流体候选复核不重跑完整传播算法。以上不构成本模块阻断。最终浏览器准出仍应使用不可变产物验证 transport fault、长期驻留往返和真实保存恢复；本审查没有用 Node 单元证据替代这些浏览器旅程。
