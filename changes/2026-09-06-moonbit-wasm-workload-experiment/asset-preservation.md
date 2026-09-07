# 方向修订时的资产保全

本文件记录审核点，不代表整个新方案完成。没有删除既有研究、实现、失败或原始性能样本；新方向的大规模实现和正式性能采样均等待本次审核。

## 工作区与历史

- 原 checkout：`/Users/chlorinec/Code/voxel-sandbox-foundation`，任务开始时main。按最初要求拉远端，13处冲突处理后合并提交 `f2454937a4217d88420e1f21ac8ffda4e94847ea`，文件树 `538fe7a9327e4841c2cd2da5ab84d4a4d834968b` 与远端 `3938eed27793cd342558165d061792ab9f12dd2a` 相同。
- 保底分支：`codex/main-before-wasm-research-20260906`；不改写历史。
- 实验 worktree：`/Users/chlorinec/.codex/worktrees/moonbit-wasm-20260906/voxel-sandbox-foundation`，分支 `codex/moonbit-wasm-workload-experiment`。
- 原方案提交 `faa719f` 完整保留，原spec/附件可恢复；当前spec为用户新方向的修订版。
- 保全时复核原checkout已位于`codex/repository-codemap`且无未提交变更；本任务未切换它，避免干扰其他工作。
- 当前代码含上一轮授权实施的可选计算adapter，开关默认关闭。没有合入main、push或发布。新的Rust core/Node-API/native尚未新增，保全快照不是生产启用批准。

## 可复用资产

| 资产              | 实际内容与路径                                                                                                              | 新方向复用/限制                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 30类负载与热点    | `workloads.md`、`kernel-cost-audit.md`、`remaining-candidate-decision.md`                                                   | 按实际两端消费者重新归类；旧Moon移植成本不是Rust永久结论                                                          |
| P0 headless       | `p0-progress.md`、`evidence/p0-aa-summary.json`、`evidence/p0-raw-profile-manifest.json` 和12份压缩raw                      | 6场景各1对A/A，真实主线程+5Worker归因；不足以代替新矩阵每场景6对噪声校准                                          |
| TS基线            | 原树f245493的冻结产物及manifest、原TS纯函数                                                                                 | 新原版A；同布局TS另列，不能把重排收益说成Wasm收益                                                                 |
| 数值ABI/生命周期  | `src/compute/kernel-memory.ts`、`wasm/seedlands-kernels/`、`tests/worker/wasm-kernel-lifecycle.test.ts`                     | 批量输入/有界arena/独立实例/trap回退；core不能沿用Wasm固定地址耦合                                                |
| 同布局TS对照      | `src/compute/*-control.ts`、`chunk-kernel.ts`、`halo-kernel.ts`                                                             | 保留算法/布局控制，决定是否仅需TS优化                                                                             |
| 强等价            | `tests/world/wasm-*.test.ts`、`tests/server/wasm-*.test.ts`、`tests/world/rust-reference-equivalence.test.ts`               | 宽域voxel、种子版本、流体事务、mesh数组/水面AO、codec字节；生成/流体/mesh Rust三族已有参考                        |
| 浏览器corpus/AB   | `e2e/workload-{corpus,worker,entry}.ts`、`workload-ab.spec.ts`、`ab-statistics.ts`、`p2-corpus.md`                          | schema2语料已冻结，补真实约465KB流体；原短测为schema1，不能混合；新矩阵尚未运行                                   |
| 浏览器统一设施    | `e2e/combined-ab*.ts`、P0 headless/CDP工具、`p3-progress.md`                                                                | 真实输入与资源身份可复用；runner已写但统一A/B未运行，后续增加backend与两环境合同                                  |
| MoonBit构建       | `scripts/{build-wasm,check-wasm,moonbit-toolchain,wasm-artifact}.mjs`、`wasm/toolchain-lock.json`                           | 固定版本/hash、自带Binaryen、源码/产物校验；不扩大服务端Moon集成                                                  |
| MoonBit产物       | `src/generated/wasm/seedlands-kernels.wasm` + `manifest.json`                                                               | 当前9788B，SHA `e342dd87279fe651eba7e649a6b5c0db172bd7653dbbf6380c272f88a7f7b17a`，保留公平浏览器参照             |
| Rust参考源码/产物 | `experiments/rust-reference.rs`、`build-rust-reference.sh`；`evidence/rust-reference.wasm`                                  | 当前8211B，SHA `4260b0cc63e361ce11c85f91e0ca777fba1f7b7c36cc01a2cf5f49662d3d4c4f`；只有Wasm参考，未假装是共享core |
| WasmGC可行性      | `evidence/p1-wasmgc-probe.json`、`evidence/moonbit-gc-probe.wasm`                                                           | 277B、sum_to(100)=4950，Node与headless Chrome验证；不是生产吞吐证据                                               |
| Worker/loader适配 | `src/worker/wasm-kernel-loader.ts`、`world-kernel-adapter.ts`、`fluid-kernel.ts`、`src/client/wasm-experiment-selection.ts` | 默认关闭，Web Worker无需共享内存；新的Rust backend需审核后接入                                                    |

机器生成raw/manifest保持原字节，不进行人工格式化；以 `evidence/preservation-manifest.json` 逐文件哈希保护当前可复用源码、测试、产物和证据。文档和manifest自身不纳入自身hash，避免循环。

## 证据分层与明确未完成项

- **已完成P0正式headless探索**：12run、6场景；raw有hash。P0没有给未采样类别伪造确定的统计上界，1ms是采样分辨率提示。
- **已完成多组实际等价**：TS/Moon/Rust参考的真实Wasm输入输出比较，成功路径断言实例没有回退。另有trap、memory.grow视图、非法ABI和输出边界的RED/GREEN。
- **旧P2诊断**：`workload-*.json/.raw.gz` 的pairs为1或2，events为2或5，warmup配置缩短。用于发现编译后处理、临时对象、输入边界和统计bug；不能作为正式ROI结论。旧bootstrap低位错误产生的CI作废，修复后有专门测试。
- **schema2新语料**：4/5Chunk fluid和扩展边界已完成逻辑检查；未跑完整浏览器矩阵。历史schema1诊断不冒充schema2结果。
- **headed旧诊断**：用户要求后立即停止，移出仓库并记录排除原因/临时归档hash；不混进正式headless数据。
- **尚未执行**：新的10配对完整分项、可靠p99样本、多线程扩展、双端统一AB、Node-API/native、跨平台发布矩阵、正式产品启用与浏览器回归准出。

## 保全检查

已通过MoonBit锁定工具链check/fmt/rebuild和hash manifest；保全构建已通过。最终静态组合入口结果在下方记录。初次全coverage唯一失败为W04随机强等价单例超5s（其余794通过、5跳过），已保留失败事实并只将该例预算调整到30s。不是改变算法或降低断言。

保全审查补了两处校验：mesh descriptor输出限制为134144记录、16B对齐；fluid写入指针必须对应输入chunk和坐标，合法arena内的错误指针同样整项回退。均真实先RED再GREEN。

## 最终范围与独立复核

用户最后明确Node/NAPI只作为Rust-first决策背景。当前范围已收敛为浏览器Rust-first，未来两端分类不构成本次Node/pool/NAPI实施。Node审计与多目标矩阵保留非执行参考，当前新增预算7–12工程人日；不沿用未来16–26日预算。

Sol独立复核确认无当前Node实施/验收/成本残留、浏览器矩阵分离语言/布局/线程，先审核后扩大实现的门槛明确。指出的P0旧文案已经修正。性能服务4188已停止，独立冻结产物目录保留；未启动新浏览器或正式大规模性能窗口。

## 最终保全核验结果

- `pnpm verify:static`通过：格式、ESLint、路径、全覆盖和两套TypeScript检查均GREEN。162个测试文件通过、3个参考/历史文件按条件跳过；797项通过、5项跳过，world行覆盖率96.64%。
- `pnpm build`通过，固定Wasm产物验证通过；构建已有大chunk提示，未把提示伪装为失败。
- 过程中严格测试配置发现corpus的`startsWith`未缩窄union、JS CLI helper声明缺失，均已修正；没有更改fixture算法或减弱断言。
- 记录：`evidence/preservation-static.log`、`evidence/preservation-build.log`。这是已有原型的保全检查，Rust-first新core、正式完整性能矩阵与产品启用仍待审核后实施。
- 本次没有新跑E2E/Midscene/正式性能采样；P0和旧诊断证据与本次Static/Build分开。
