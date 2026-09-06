# Rust-first 浏览器计算内核：修订实施合同

状态：**方案修订审核点；现有原型已冻结保全，不启动新方向的大规模实现。**

指令依据：用户明确浏览器 Integrated Server 长期保留；Rust-first 的背景是未来多个长期运行环境。用户最后澄清：**现在不实现 Node Dedicated Server 和 Rust Node-API**。因此未来路线仅约束核心边界，当前实施和验收仍是浏览器 Wasm 优化。用户此前要求修订方案在扩大实现前汇报审核，该阶段门槛保留。

原方案提交 `faa719f`、原spec SHA-256 `4f3ce7b0b0fd84d35994c2bd338ccb573572cca156a747cda7ac0347c7d2a992` 和已授权本地实现全部保留。旧 MoonBit 默认优先规则由本合同替代。

## 背景与目标

用纯 Rust 共享计算核心承载高 ROI 算法，当前编译为浏览器 Web Worker 使用的 Wasm。继续对浏览器 Integrated Server 做正式分项 A/B和正收益项统一 A/B，保留原 TS、同布局 TS 及已经完成的 MoonBit 作为公平参照。不是为了引入 Rust 或 Wasm 而强行迁移。

完成态：全部候选有成本/收益结论，过门槛项目在浏览器真实消费者路径中通过确定性、失败回退、性能和部署预算；核心结构可被未来 Node-API/native adapter直接依赖，但不提前实现未来服务端产品。

## 范围与不做事项

**当前做：**

- 保全30类 workload、P0 profile、TS原版/布局控制、数值ABI、corpus、MoonBit与Rust Wasm参考、loader/Worker/headless评测设施。
- 先以W02数值列到Chunk填充、W07有界流体候选、W14编解码/CRC三类形态验证纯Rust core与Wasm adapter；只完成边界明确的纯计算，不迁权威状态机。
- 浏览器专用W03 halo、W04/W05 mesh descriptor、W06打包继续按ROI评价Rust/Moon/TS。W04/W05是一个描述符计算单元的两类分项场景，不重复计功。
- W01/W08/W11/W16等已超原成本门槛的项目保留审计，按Rust共享复用价值重新评分；首MVP不扩大为完整宏观数学、物理或Nav重写。
- 纯Rust在宿主target编译与单元测试，必要时运行同core的小型native benchmark作诊断；它不替代浏览器端到端结果，也不发展完整native工具产品。

**当前不做：** Node Dedicated Server、worker_threads pool、Node-API addon、Node产品A/B、网络/多进程分片、磁盘持久化改造、正式native CLI/服务器、跨平台native二进制发布。`node-target-plan.md`与`future-multi-target-matrix.md`仅保留长期背景，不属于本次验收与预算。

不改变World.edit、generatorVersion、存档字节、Authority tick/提交门禁、PlayCanvas渲染边界。所有浏览器测试headless；不声称可见窗口真实FPS验收。默认不push、不发布、不合入主分支。

## 关键决策

### 一个纯核心，当前一个生产adapter

```text
crates/world-kernels/          纯Rust算法、数值结构、确定性、校验与scratch
crates/world-kernels-wasm/     当前实现：Wasm批量导出、线性内存与ABI检查
未来 world-kernels-napi/      不在本次实现：只允许依赖同core
未来 world-kernels-native/    不在本次正式产品范围：工具/benchmark/服务端适配
```

core不依赖Node、napi、wasm-bindgen、js-sys/web-sys、Wasm global、浏览器/Worker、网络、调度、文件I/O、时间或随机宿主状态。接收有界slices和显式数值结构，返回有序完整结果，scratch由调用方持有。不含固定Wasm地址或JS对象；相同核心能编译为wasm32和当前host target。

现有Rust reference带固定线性地址，不能直接改目录名就称为纯core：复用算法和oracle，先把地址/内存读写提取到Wasm adapter。Cargo workspace、Cargo.lock、精确toolchain与依赖门禁先行。`cargo metadata`传递依赖检查和正反例测试强制边界，不只写架构文档。

首版Rust与Moon/TS坚持相同算法、布局、排序和批量，不先引入Rayon、fastmath、relaxed SIMD或不同的树/堆算法。布局改进必须有TS控制。f64宿主数学不假定逐位一致，W01保留TS；W02预采样和整形成本算进端到端，不能把填充核收益说成整个生成器Rust化。

### 浏览器线程与状态

保留当前默认五Worker：Authority、Logic、Fluid、General、Persistence各一；每个需要计算的Worker独立单线程Wasm实例和内存，不再创建Wasm内部线程，不使用共享内存或新增COOP/COEP要求。额外General Worker是单独拓扑变量，不能与换语言一起计功。

Rust只返回候选，TS保持唯一权威状态、tick编排和epoch/revision/read-set校验。批量Chunk/候选/record级接口，禁止逐实体/voxel高频跨界。物理同步时间预算不被异步pool改写。

输入冻结且不修改；内存增长后重建view；输出长度/整数宽度/对齐/指针来源与坐标一致性检查。失败或trap停用实例并整项TS回退，不提交半份结果。取消/过期结果不进入Authority。公开ABI与消费者metadata版本绑定，开关关闭不加载Wasm。

### Rust-first与MoonBit的精确定位

共享计算默认Rust，以避免未来Wasm/Node-API/native各写一份算法。未来复用是取舍依据，不能代替当前浏览器正收益。

停止增加服务端MoonBit算法或产品接入。现有MoonBit仍公平参加浏览器代表项和已实现候选比较；若浏览器专用实现有明确性能、体积或可核验开发效率优势，且覆盖双实现维护/确定性成本，可以保留。旧“接近Rust就默认MoonBit”的规则失效。

维护估算固定未来12个月、每季度发布、每内核两次规则修复情景；MoonBit额外预算≤0.5工程日/次修复、≤4工程日/年。除正常ROI门槛外，Moon相对最佳Rust/TS至少有可验证的性能≥15%改善且CI>0，或gzip≥30%减少且延迟/启动无超5%退化，或同合同实际开发+修复工时节约≥30%并覆盖全年额外维护。开发成本未实测不冒充优势；小体积百分比仍须满足绝对产品收益。

## 可验证行为

1. Given同一seed/version/编辑和输入，When TS原版、布局TS、Rust Wasm及已有Moon计算，Then逐字节/字段一致、输入不变。核心host tests与Wasm使用同oracle；任何不一致使性能样本无效。
2. Given只改变语言，When比较，Then同Worker数量、数据布局、算法、输入批量、复制/传输/工作区复用；算法/布局、搬线程和语言分别归因。
3. Given开关关闭、产物无法加载、非法ABI、trap或错误输出，When请求计算，Then原TS整项回退、权威规则不变；采样记录fallback并判无效，不假称Wasm成功。
4. Given取消、epoch变化或旧revision，When计算完成，Then维持现有陈旧结果拒绝和提交顺序。
5. Given分项正收益集合，When统一A/A′/B，ThenA为冻结原TS、A′为新适配全关、B只启用通过项；维持画质/输入/内部尺寸/五Worker，整体回归则消融或不启用。
6. Givencore依赖检查，When引入Node/Wasm宿主依赖或固定地址，Then静态门禁失败；未来扩adapter无需移动/复制算法才能通过。

## 测试设计

审核后先用例RED，再实现：

- `tests/governance/rust-core-boundary.test.ts`：Cargo传递依赖、核心宿主禁止项、adapter单向依赖及产物hash；Static/Vitest。
- `crates/world-kernels/tests/`：生成/流体/codec已知答案、容量、非法输入、稳定排序、host编译；Static（Cargo test）。
- 扩充已有`tests/world/wasm-*.test.ts`、`tests/server/wasm-*.test.ts`与Rust reference oracle：真实Rust产物、无fallback的逐字节等价；Vitest。generator2/3、负坐标、跨chunk、水面AO、存档tie/损坏边界均保留。
- `changes/2026-09-06-moonbit-wasm-workload-experiment/e2e/`：Rust backend、单线程TS kernel参照、同布局控制、headless分项/统一、失败/取消。仅本change显式执行，不扩长期E2E基线。
- 精确mesh输出不变且无UI/视觉语义改动时Midscene为N/A；若出现可见差异应修复等价，不能放宽验收。真实浏览器输入与回退仍需Playwright，不用Node测试替代。

## 验收与证据

| 条件                                                   | 证据类型                                         | 状态                                     |
| ------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| 原资产/原始样本保全、旧方案可恢复、当前scope无Node扩项 | Static / Manual supplement                       | 已完成盘点与冻结；保全快照核验中         |
| 纯Rust core与Wasm adapter分离，host/wasm编译与架构门禁 | Static / Build / Vitest                          | 待本次审核后实现                         |
| 三形态跨语言强等价，原始世界/事务/存档规则不变         | Vitest / Static                                  | 已有Moon/Rust Wasm部分参考，新core待完成 |
| 所有候选按ROI给分项采用/拒绝理由，当前浏览器矩阵完整   | Playwright-change / Manual supplement            | 有P0和短探针；正式10配对矩阵未完成       |
| 所有通过项统一A/A′/B，满足主指标/尾延迟/内存/启动预算  | Playwright-change                                | 未执行                                   |
| 原版回退、关闭、取消/失效、真实输入均正确              | Vitest / Playwright-change / Playwright-baseline | 原型部分通过；Rust接入后重新执行         |
| verify:static与生产build通过                           | Static / Vitest / Build                          | 保全检查另记，不等于本change整体准出     |
| 视觉语义无改变                                         | Vitest / Playwright-change；Midscene N/A         | 严格mesh字节合同；无新的视觉设计         |

本次绑定附件：`overview.md`、`ab-plan.md`、`workloads.md`、`asset-preservation.md`、`research.md`。未来Node/多目标文档明确非本次实施附件。审核清单绑定spec及上述附件SHA-256；失败/诊断和最终正式证据分层。

## 任务与当前状态

- [x] 主checkout更新、冲突处理、独立worktree。
- [x] 30负载、P0 headless、数值ABI、多组等价、已有Moon与Rust对照。
- [x] 停止扩大单环境Moon投资，保留浏览器产品实验和所有原型。
- [x] 按最新澄清缩回当前范围：Rust-first浏览器Wasm，无Node/NAPI实施。
- [ ] 用户审核本次精确spec/附件hash。
- [ ] M1：先一个最小codec/CRC core+Wasm闭环，再生成/流体三形态。
- [ ] M2：候选成本复评、分项四变体、只有正收益才接入。
- [ ] M3：统一AB、原TS回退与静态/构建/浏览器准出，语义化本地commit。

主负责人负责架构/首个MVP/归因/准出；Sol负责独立评测与审查，Terra负责冻结合同内的Rust算法迁移，Luna负责Wasm薄adapter/工具链/manifest。性能窗口串行，所有浏览器headless。

## 交付快照

当前交付为**修订方案与保全点**，不是优化功能准出。默认开关关闭，未合并main或push；原方案可从`faa719f`恢复。没有正式完整AB性能结论，没有Rust core新产物，没有Node/NAPI实现。保护性检查与本地快照见`asset-preservation.md`。
