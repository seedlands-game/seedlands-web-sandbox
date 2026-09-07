# 数据平面规范、AoS复制审计与SIMD实验

## 背景与目标

用户本轮明确要求：把控制平面AoS、数据平面SoA写入项目规范；核实导航/物理反复复制并提出修复方案；核查并实验SIMD，过门槛才采用；固定WebGL2，不引入GPU/WebGPU compute。本change是有界追加任务，不把尚待审核的完整Rust迁移或未来Node/NAPI扩入当前范围。

## 范围与非目标

规范落在AGENTS.md；审核实际创建/复制/传输链路并记录证据。先比较三个规则性数值负载：occupancy分类、UV位打包、RGBA/索引打包，Rust相同算法的scalar/SIMD与既有TS控制。保持同输入、内存/线程、传输、边界条件。复用现有headless设施，不启动headed浏览器。

本轮导航/物理重构交付可评审方案，不未经实测大范围改写权威/公开协议。不新增Node/NAPI/GPU路径，不重启WebGPU实验，不把用户所述历史延迟上升伪装成本轮复测。

## 决策

AoS用于领域对象、命令/状态/关系；SoA或紧凑数值缓冲用于已经实测的高频批量计算和跨界。SoA不是零拷贝保证；任何slice、clone、结构化克隆、Wasm入/出拷贝都有明确所有者/频率/bytes预算。默认转移派生缓冲，不能转移并detach权威仍在用的buffer。用revision/epoch驱动缓存，不能每tick把AoS全量来回转成SoA。

当前SIMD使用标准simd128，仅整数位操作，禁用relaxed SIMD/fastmath/共享内存。先portable Rust scalar与相同布局SIMD，尾项按标量完成；浮点UV按已有bit截断规则，不改半精度舍入/NaN策略。独立产物探测SIMD支持，失败回退标量/原TS，不能在不支持浏览器先加载含SIMD模块再想回退。

算法核心可host编译，无DOM/Node/网络/JS对象；Wasm ABI和target-specific SIMD backend留在独立适配模块。首MVP先occupancy，由主负责人完成后再分派其它机械实现。若全任务/生产消费者无净收益，保留实验证据，不因内核倍率大而启用。

## 行为

- Given相同输入与尺寸，包括0、尾项、未按16B对齐、极值，When scalar/SIMD/TS运行，Then逐字节结果及最大索引一致，越界拒绝，输入不变。
- Given候选通过采用门槛并接入产品后，不支持SIMD/损坏产物/异常输出，When加载或调用，Then使用标量或原TS整项回退，显式诊断，不误算性能成功。
- Given导航/物理访问，When审计，Then区分AoS对象遍历、显式复制和消息克隆，给源码调用链/频率/bytes，不能仅由AoS推断重复复制。
- Given后端选择，When启动当前浏览器，Then继续WebGL2，无WebGPU compute入口；规范明确仅GPU渲染保留，不引入计算迁移。

## 测试设计

实现前：`tests/governance/data-plane-policy.test.ts`规范/当前WebGL2合同RED；`tests/compute/simd-kernel-equivalence.test.ts`真实scalar/SIMD模块缺失RED，继而随机/全域/边界对等；当前change/e2e下SIMD分项headless测试。

正式测量至少10对平衡AB/BA，5秒预热，同等批量与内存复用。计核心、JS边界+复制、Worker全往返，p50/p95/p99、bytes/启动/内存。小核时钟不足则核心按等量重复批次报告，禁止把重复核心次数用于伪造全任务收益。每run至少1000个完整任务作分布，统计独立单位为run。performance不与编译/测试并行。

网格原 TS 在大输入触发数组展开调用栈上限；保留每个失败 corpus 编号，正式标量/SIMD使用同一 `runMeshPackKernel` adapter 与 staged TS arena control。原 TS 可执行条目仍逐一比对正确性，失败条目不得算作 TS 慢或 SIMD 加速。

先探索筛选，再确认正收益项；只有全任务p50>=15%、CI下界>0、尾延迟无超过max(0.05ms,5%)退化，并满足真实生产粒度的绝对预算（>=0.2ms/task或>=1ms CPU/sec）才扩入当前可选内核路径。无法证明生产收益时标记仅kernel加速/不启用，不宣称FPS提升。所有正收益适用项组合后另做同流水线AB；当前不替代父change完整游戏AB。

## 验收与证据

| 条件                                       | 证据                                   | 实际结果                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AoS/SoA、所有权与复制规范，固定 WebGL2     | Static / Vitest                        | AGENTS.md 与治理用例通过；README 双语同步新增工具要求                                                                                                        |
| 导航/物理真实调用链与修复方案              | Manual supplement / Static             | `aos-soa-audit.md`、`proposal-overview.md`；三个 Node 尺寸探针/原始 JSON 保全。方案未冒充已修复                                                              |
| 旧产物与新增 SIMD 指令状态                 | Static                                 | 旧 Moon/Rust 均无 SIMD；新增 scalar 0、SIMD 91 条 SIMD 指令，均无 relaxed 指令；见 `simd-instruction-audit.json`                                             |
| 强等价与 ABI 边界                          | Vitest                                 | 本轮 13 个相关用例通过；包括 65,536 voxel ID、UV 极值、尾项/未按 16B 对齐、越界/重叠拒绝、高位 u32 max、实际 TS 语义、源码/产物 hash 和实际 arena/stack 边界 |
| 7 项正式 headless A/B 与采用结论           | Playwright-change                      | 7/7，通过；每场景 10 对、每模式 1,000 任务、5秒预热。`simd-results.md` 与逐任务压缩原始数据；无候选通过全部产品采用门槛，当前不启用                          |
| 产品 SIMD 能力探测/回退                    | N/A                                    | 本轮未接入产品，没有新 loader；harness 明确要求 SIMD 能力，加载失败不能冒充 SIMD 成功。未来采用前仍必须实现并测试                                            |
| 项目静态、确定性、构建                     | Static / Vitest / Build                | `pnpm verify:static` 通过：810 passed、5 skipped，world 行覆盖率 96.64%；`pnpm build` 通过。Rust core 宿主编译与 Rust 格式检查通过                           |
| 完整游戏旧版/新版 A/B、GC、独立 Worker RSS | N/A                                    | 本轮仅数值任务与打包阶段；没有通过产品门槛的项可合入。GC/RSS 标记 NOT_COLLECTED，不能用内存容量替代；没有宣称完整游戏性能准出                                |
| 视觉/输入语义                              | Midscene N/A / Playwright-baseline N/A | 没有视觉、输入或生产运行路径变更；本轮未新增或提升长期浏览器基线                                                                                             |

补充 RED 记录：规范文本缺失、首次 Rust Wasm 产物缺失、W06 导出缺失均曾实际失败后转绿；ABI 修正前 arena symbol/stack 边界和合法高位索引 max 反例也失败，日志保全为 `evidence/abi-regression-red.log.gz`。短跑暴露的粗时钟零值及旧 TS 大数组展开错误已分别按指标不可判定、限定 staged 对照处理，未删除不利样本。

## 任务与当前状态

- [x] 读取当前代码与父change保全点36a0022；原checkout其他任务分支不干预。
- [x] 规范RED→更新AGENTS→GREEN，Rust core 边界加入正反例。
- [x] AoS复制审计与方案，三个 Node 尺寸探针与原始 JSON 保全。
- [x] SIMD现状审计，Rust最小MVP与强等价；修正 arena/stack 分离与 u32 max 返回码。
- [x] 七组有界候选 A/B 与两组打包组合完成；保留候选实现，当前拒绝产品默认启用。
- [x] 交付记录与准出完成；创建包含本记录的本地语义化提交，不 push。

## 交付快照

本轮已完成规范、复制审计/修复方案、Rust scalar/SIMD 实现与有界 A/B。生产 `src/` 未修改，原有 MoonBit/Rust 原型、父 change 与默认关闭的产品 Wasm 开关保持保全状态。修复方案提出的 EntityStore、Logic、碰撞/流体复制重构尚未执行；本轮不包括 Node Dedicated Server、Node-API、GPU compute 或完整 Rust 服务端。

- 工作树：`/Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation`。
- 分支：`codex/moonbit-wasm-workload-experiment`。测量时父 HEAD：`36a0022657d2c14053f1575814f9fd148df0d0c6`；当时尚未提交的实际 bundle 和二进制以已保全 SHA 为准，不能把父 HEAD 单独说成已测源码版本。本交付提交包含相应源码。
- 变更文件：AGENTS/双语 README；新 `crates/world-kernels` 与 `world-kernels-wasm`；SIMD 构建/linker/运行/汇总与 core 治理脚本；当前 change 的设计、审计、7 项 headless 用例、证据；对应确定性/治理测试；必要的 ignore/路径规则与包命令。
- 新产物：scalar 1,794 B，SIMD 3,524 B；两者独立线性内存 18 MiB、最大32 MiB。源与产物 hash 见 `evidence/simd-build-manifest.json`，实际浏览器 bundle 见压缩保全包。
- 运行：2026-09-06 至09-07，Apple M3 Pro / arm64 / Node26 / headless Chrome，单 Web Worker、无跨源隔离。正式7项耗时48.4分钟，没有并发构建或测试干扰；后续静态与构建在采样结束后执行。
- 校验：`pnpm verify:static`、`pnpm build`、本轮13个相关用例、`cargo +stable check --manifest-path crates/Cargo.toml -p world-kernels --locked`、`cargo +stable fmt --manifest-path crates/Cargo.toml --all -- --check`、`git diff --check`通过。完整日志在 evidence 下；构建保留既有大 chunk 提示，无新增构建错误。
- 采用：热内核下降15.1–80.5%；混合/压力网格打包阶段平均下降19.4%/22.6%，独立任务平均下降7.7%/4.6%。未过预注册门槛，保留 SIMD 候选代码而不新增生产 loader。详细 CI、尾延迟、绝对预算及限制见 `simd-results.md`。
- 评审：主负责人完成首MVP、ABI/内存边界、决策与验证；Sol承担复制调用链审计，Terra承担W06机械实现，Luna承担工具链/依赖边界与独立只读复核，记录见 `review.md`。这些是当前有界工作的内部审查，不替代父 change 的整体迁移审核。
- 限制：未测游戏 FPS、真实游玩、独立 GC/RSS、多 Worker 扩展、其它浏览器/平台以及 Node/NAPI。staged TS 的高位 max/非法 overlap 拒绝规则与 Rust 有差别，当前合法低索引 corpus 不触发。旧 TS 大 mesh 容量错误另列修复建议，未将它当作语言性能收益。

本轮用户明确授权有界规范、审计与 SIMD 实验/条件采用；未借此启动父 change 的完整 Rust 迁移或权威状态机重写。原主 checkout 上其它任务的分支不干预，无远端写入。
