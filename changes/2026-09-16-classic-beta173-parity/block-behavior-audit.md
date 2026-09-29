# B-000..B-096 方块行为候选审计

本审计的逐 ID 记录在 `block-behavior-candidates.json`：97/97 个 ID，每个非空气 ID 都有固定提交 `740c583901e1ff1150e9ef37e37dab5bc0e4f807` 的 `Block.java` 注册行，以及可定位的子类/父类方法候选。它不运行原版、不复制源码，且不把重构源码或注册存在表述成已验收行为。

## 覆盖读回

| 范围     | ID 数 | 记录 | 处理                                                               |
| -------- | ----: | ---: | ------------------------------------------------------------------ |
| 做       |    73 |   73 | 每项有固定世界下放置/交互正例及无效 support/tool/metadata 负例模板 |
| 排       |    21 |   21 | 每项有禁止普通取得、放置或排除机制触发的负例模板                   |
| 存       |     3 |    3 | 每项有“不得无意引入普通生存来源”的负例模板                         |
| 其中空气 |     1 |    1 | 已含于“做”；空体素/不可碰撞/不可静默抹除 owner state 模板          |

提取到 69 个注册类；五类方法槽（放置、掉落、碰撞、tick/交互、TileEntity）共 480 个非空气候选槽，其中 394 个至少有固定源码方法定位，86 个没有匹配的方法签名。v16 按**每个方法名**沿实际继承链寻找最近声明，记录 `inheritanceChain`；例如小麦 `BlockCrops → BlockFlower → Block` 的放置判定由 `BlockFlower` 提供。旧版只看当前类再按整槽回退基类，会误指方法归属。394/86 计数恰好未变，但候选源码链接发生实质变化。这 86 个仍是“必须人工看构造参数或渲染/材质路径”的**来源缺口**，不是默认行为通过。

## 每项记录包含的可执行合同骨架

每个 JSON record 都有：

- `static`：ID、类、硬度/光/不透明度/抗性调用参数/踏步音/不可破坏标记；数值只来自注册行。
- `methodCandidates`：各维度可定位的类方法和固定 commit URL/行号；同名方法以最近的声明类为入口。源码入口不等于执行了 `super` 调用链，也不证明没有语义差异。
- `expectedCandidate`：仅定义需要哪类 fixture 才能断言放置、破坏/掉落、碰撞/形状、光、metadata 与 TileEntity/save。
- `fixture.positive` 与 `fixture.negative`：正例固定空世界/支撑/metadata/工具/RNG；负例固定无支撑、阻挡、错误工具、非法 metadata 或排除范围触发。
- `gaps` 与 `confidence`：所有行为仍缺官方 jar 等价、固定 RNG/tick 输入、owner state、save/resume 和执行证据，故为 medium 或更低的“源码候选”。

## 已知需逐类人工复核的高风险簇

- 液体、火、TNT、农作物、树叶、仙人掌/甘蔗：随机 tick、跨格传播、掉落与 metadata 不能只靠注册或单次操作。
- 门、床、告示牌、箱子、熔炉、刷怪笼、音符盒、唱片机：双格/TileEntity/NBT/库存/文本/音高必须做保存恢复与失败回滚夹具。
- 楼梯、半砖、雪层、梯子、围栏、轨道、活板门：AABB、朝向和邻接拓扑必须单独测量；没有类方法不等于完整方块碰撞。
- ID 49/51/90：已保留的黑曜石、火和打火石会触发 portal 创建路径；多维度排除的偏离合同仍是 NO-GO。
- ID 23、75/76、27/28：发射器手动容器、红石火把照明、无电轨道形态曾是范围审计的 `核` 候选；[现行 v16 范围合同](spec.md#排除依赖的默认裁决供整份合同审核)已明确随电路装置整体排除。不能因本文件列出源码方法而升级为 `做`；如用户改选须升版本与预算。

## 验证命令

```sh
node changes/2026-09-16-classic-beta173-parity/build-block-behavior-candidates.mjs
node -e "const d=require('./changes/2026-09-16-classic-beta173-parity/block-behavior-candidates.json'); if (d.records.length !== 97 || new Set(d.records.map(x => x.caseId)).size !== 97) throw Error('coverage'); console.log('97 block records: PASS')"
```

终态：`SOURCE_CANDIDATE_REVIEW / NO-GO`。97 条是来源和 fixture 设计覆盖，不是 97 条已冻结 expected、更不是可开工证明。
