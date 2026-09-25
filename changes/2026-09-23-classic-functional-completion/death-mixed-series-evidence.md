# V2 death mixed series 与 predecessor capture 证据

阶段：`V2-DEATH-MIXED-SERIES-01 + PREDECESSOR-CAPTURE`  
基线：`9f5a6ff49cccb1e5ecb9fae9ae0ab9277f42769e`  
状态：公共 mixed entity series 与 pre-death V4 exact identity 已完成定向验证；未接 producer 或 Classic。

## 行为结果

- 新增 `DeathInventoryAdditionalActorReplacementV1={source,replacement}`。source 与 death candidate 使用同一完整
  freshness 检查，replacement 只允许同 lifetime 的存活 actor。调用方对象在 prepare 返回后被修改不会污染结果。
- additional actors（包括可选 position/physics velocity）、death actors/despawns、container drops 与 intrinsic drops 进入一次
  `prepareEntityMutationSeries`，沿用每段 `128` entries 与总计 `192` segments 预算。
- mixed 正例同时提交 survivor needs 变化、player death、inventory/cursor/crafting/armor 四容器掉落各一次；
  `129` actor entries 跨 segment 后仍同一 frontier。
- health/needs/armor/inventory revision、epoch/lifetime、prepare 后 touched snapshot、跨集合 duplicate、reference mismatch、
  伪死亡 additional、额外 spawn/despawn 字段与末端 spawn capacity 均 fail closed 且零写。既有 death-only series
  和 single participant 行为未改变。

## RED 与中间失败

| 记录                     | window                                 | 结果                                  | 结论                                                                                      |
| ------------------------ | -------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `red`                    | `f8ab75d1-9d94-416f-86b3-5d456195fa8d` | EXPECTED FAIL，`1 failed / 12 passed` | 旧 API 忽略显式 additional replacement；死亡提交后 survivor hunger 仍为 `20`，预期 `17`。 |
| `green-01`               | `0b0f4537-ab8c-4704-b079-f9c0cfb1a83d` | FAIL，`1 failed / 19 passed`          | duplicate 负例先命中“additional 必须 alive”；属样本构造顺序，不是事务缺陷。               |
| `green-02`               | `875b4a97-e7b2-4a7d-9dc9-04027fcfc9e0` | PASS，`20/20`                         | 修正 duplicate 样本后的初版 GREEN。                                                       |
| `green-03`               | `a9593c78-9e0d-41b1-883d-dafacb483122` | PASS，`21/21`                         | 增加四容器同批断言和严格输入后通过。                                                      |
| 初次 ESLint              | `0aa3ba00-83d9-42e4-a47e-492527d99b8a` | FAIL                                  | 原测试文件达到 `520` 行，违反 `max-lines=500`；原始输出保留。                             |
| `moved-tests`            | 见同名 receipt                         | PASS，`4 files / 35 tests`            | mixed 用例迁至独立测试文件，旧 series 文件恢复 304 行。                                   |
| `final-tests`            | 见同名 receipt                         | PASS，`4 files / 36 tests`            | 增加 detach 用例后的中间结果。                                                            |
| `tests-final2`           | `c013a0e2-7af1-4b23-b21a-abccc79aa5ec` | PASS，`4 files / 38 tests`            | public export 与独立 epoch/lifetime 负例后的中间结果。                                    |
| `tests-full-replacement` | `6b5c53d5-c295-42ae-a237-3218908934af` | PASS，`4 files / 38 tests`            | 完整 `PreparedActorReplacement`（含可选 position/velocity）冻结后的最终行为结果。         |

## Predecessor Capture

窗口：`551425ae-8b02-4947-b4e4-f52d9a889f90`，状态 PASS。捕获脚本、stderr、window receipt 与完整
identity 均保存在 `evidence/v2-death-mixed-series-01/`。输入身份：

- clean tree source `1bbe3a60d55ffa5d05e405377624fbbd942e6327` / tree
  `4d70cef0e00c8617290159e1aa83a685126b1fc4`，捕获前后 `git status --porcelain=v1` 为空。
- artifact receipt SHA-256 `aa4f6d8056335413523964fd1d2d4630c5261fb7ee4477c879a54ad0c145281a`，
  artifact digest `7e0d5f80a2751b914ff16f24af6d967dbc300b31b7f11db532c9c947596c0a78`。
- packs.lock SHA-256 `fd4054012073c1252f7f8a63d9d9d09ac968620c6859cff9ca78aaebda3d2332`；
  实际加载 Pack manifest `14e53b01...5bcb3`、entry `4b12ea60...8142` 与两项资源。
- canonical identity SHA-256 `e799b930b686da9a8bd34d9052e4179e8624013bcbc774da81ff672ed6cd724a`，
  `39998` bytes、`22` modules、`28` capabilities。

脚本使用 artifact 所在 clean tree 自带 loader 与 assembly/canonicalizer；esbuild 只生成内存 ESM bridge
（`write:false`），没有从当前 dirty source 拼图、没有按新 target 删除 death、没有重建 Pack。

## 静态验证

- stdlib typecheck：PASS（`ae53be17-15da-4d41-a4e8-f3795a708deb`）；root test typecheck：PASS
  （`e3ad8993-a41e-446a-9f49-6cc1c7756a71`）；Classic test typecheck：PASS
  （`6cea3100-bad2-4e80-954f-28767087eb78`）。
- 精确 ESLint：PASS（`b517b0a4-fe23-4326-8b7c-b9d67a596312`）。机器生成的完整 identity JSON 保持原始
  capture 字节，不用 Prettier 改写；其余可编辑文件的最终 Prettier check PASS
  （`b75fa488-0bab-4d88-a679-00b424916307`），scoped diff PASS
  （`d7f6ddc2-de9f-4728-8b8a-3bd6337831bc`）。
- 所有测试与检查通过默认 benchmark window，Vitest 固定 `--maxWorkers=1`；未运行 build/browser/Cua/CI。

## 范围与预算

本片未修改 761 所有的 registered Combat、Vitals、GameplayRuntime/domain adapters 或 spec，也未修改 Classic Pack/
migration。当前工作树中这些文件的并行 dirty 不属于本证据。长期 docs 不更新，原因是公共 owner 分层未变化。

传统人工估算 `1.5-2.0 PD`；AI 预计 `3-5h`、保守 `x120%=6h`，实际活跃约 `1.0h`（含有界恢复与验证）。
模型 credits、API 等价费用、额度和分母均为 `unknown`。

未验证：producer wiring、稳定 missing-policy failure、Needs effect 与 ECS 的跨 owner apply 原子性、Classic policy/predecessor
安装、pre-Media migration、真实 save restore、build、Browser/Cua、CI、发布。
