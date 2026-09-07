# 数据平面修复方案概述

## 已确认的问题

现状大方向符合“控制平面 AoS、数据平面 SoA/packed buffer”，但热点仍有不必要的副本与装箱。普通稳定实体 tick 的 Authority 物理链会调用 `GameplayEntity.clone` 共 `4N+2P` 次，其中写回产生的 `2N` 个返回副本无人使用。物理解算留在同一 Worker，并不是物理 AoS 反复跨线程。Logic 的对象观察和 intent 各走两跳，occupancy buffer 则已用 transfer。导航主要浪费在字符串校验、窗口线性查找和反复排序。完整调用链与精确字节见 `aos-soa-audit.md`。

## 建议按三个独立变更推进

| 顺序               | 修复内容                                                                                                   | 可先验证的减少量                                                                                                                         | 准出重点                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1                  | EntityStore 私有无返回 mutation；Authority 批量/void 写回。外部 get/query/update 继续返回独立副本          | 稳定 tick 去掉 `2N` 次无用 clone；`N=5,P=1` 时 22→12（45.5%），`N=129,P=1` 时 518→260（49.8%）。只是实体 clone 调用数，不是物理 CPU 降幅 | 调用计数、公开副本隔离、逐 tick 状态/拾取/增删实体等价；先做 TS A′                             |
| 1，可独立分项      | 接管已 transfer 的 collision baseline；generated 快路径仅创建必要的第二所有者；fluid Worker 使用其独占输入 | baseline 少 98,304 B/Chunk；generated 快路径至少少 65,536 B/任务；fluid 少 98,304 B/Chunk/任务                                           | alias/所有权、发送方 detach、过期 lease/revision、取消与重试；保留 Authority 验证快照          |
| 2                  | Logic 控制头保留对象，热字段连续化；用 MessageChannel 直连 Authority 与 Logic                              | observation/intent 各少一次中继对象 clone；不是 occupancy 再少一次字节复制                                                               | lifecycle、背压、latest pending、epoch、断线/关闭清理、双路消息顺序                            |
| 2，可先做 TS       | 导航 window 索引、区间相交校验、numeric node/parent storage、稳定 heap 或无分配最小扫描                    | 删除每批大量格子字符串与反复 open 数组排序，实际 ms 待测                                                                                 | 固定原 tie-break；路径、unknown chunk、intent 逐项等价；不得混入换算法收益                     |
| 3，有 profile 再做 | 有界 PhysicsFrame、复用碰撞 scratch/窗口、Rust tick 级 batch seam                                          | 避免每 body 的 JS/Wasm 调用和重复装箱；尚不能承诺收益                                                                                    | `Float64` 数值语义、状态顺序、碰撞/grounded、角色推离、采样/提交 revision；先同布局 TS 再 Rust |

这里的第 1 项是最小可交付修复，第 2、3 项才涉及协议与更深的数据布局。不要在第 1 项就把整个权威状态转换成 SoA，更不能每 tick 为“符合规范”额外做整套 AoS↔SoA 往返。低频控制对象、小量 delta 和领域 union 保留 AoS。

## 实验中发现的额外容量边界

网格旧 TS 路径在大数组 `push(...values)` / `Math.max(...indices)` 上触发 `Maximum call stack size exceeded`。这是独立的容量/实现问题，不能算成 SIMD 优势。建议另做一个很小的 TS 修复：分组时预分配 TypedArray 并用 `set`，最大值用循环扫描；用原实现可执行 corpus 做等价，再用超出参数上限的大 mesh 做回归。当前 staged control 已为性能实验提供相同数值规则的可执行对照，但没有把它自动替换进生产。

## 证据与投入控制

- 每个修复独立 A/B，通过后才做组合 A/B；同时记录 clone/显式 copy bytes、Authority/Logic CPU、p95/p99、GC/峰值内存和正确性。精确 copy 减少量用于解释因果，不能替代 CPU/帧延迟实测。
- 所有新浏览器测试继续无头；只对本 change 的数值/传输行为设计确定性用例，不把性能变化当作视觉或真实游玩体验已验收。
- 跨 Worker 协议或权威数据布局变化各自另立 spec 与冻结 corpus；本次用户要求的是确认与修复方案，这些生产重构当前未执行。
- WebGL2 保留；不新增 GPU compute、WebGPU、Node Dedicated Server、Node-API 或完整 Rust world server。Rust core 保持未来复用所需边界。

## 当前 SIMD 决策边界

新增四个 Rust scalar/SIMD 内核，只比较同算法、同布局。occupancy、UV、颜色、索引做分项，网格三项一起做组合。实际采用结论见 `simd-results.md`；只有整个消费者任务有可信净收益才接入产品，内核快数倍本身不构成采用依据。CRC、流体传播和导航的当前串行/分支型结构不机械 SIMD 化。
