# Beta 1.7.3 重构源码的来源可信度审计

审计日期：2026-09-17。此文件只审计静态来源的可追溯性；没有下载、运行、安装或分发原版客户端/jar，亦未把任何原版代码或资产写入本仓。

## 裁决

`jacobo-mc/mc_b1.7.3_release@740c583901e1ff1150e9ef37e37dab5bc0e4f807` 是一个**可复现地址的二级候选来源**，可支持“该仓库在这个 Git tree 中如此登记/实现”的静态事实。它**不是** Mojang 官方客户端字节码、官方 mappings，或“源码与 b1.7.3 jar 等价”的证明。

因此，静态来源不足以通过整份 Classic parity 合同的审核门槛，更不能宣布 `READY`、`PASS`、原版 1:1 或可开工。它至多可以保留为 `SOURCE_CANDIDATE`；任何依赖其数值、控制流或配方的合同项仍须把“该候选源码所述”与“官方 jar 已核验”区分记录。

## 已核验的事实

| 断言                 | 实际证据                                                                                                                                                                                                                                                                                                                                                          | 能证明什么                                                                          | 不能证明什么                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 版本身份             | Mojang 官方 [version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json) 中 `b1.7.3` 为 `old_beta`；其固定 [version JSON](https://piston-meta.mojang.com/v1/packages/44f6969326bd45aa00dcd3c4ca3a7c05ebb24c04/b1.7.3.json) 给出 client SHA-1 `43db9b498cb67058d2e12d394e6507722e71bb45`、大小 `1465375`、发布日期 `2011-07-07T22:00:00Z`。 | 官方下载对象的身份是该 SHA-1。                                                      | 该 jar 的源代码、类名、反编译文本，或任一 GitHub 源码 tree 等价于它。            |
| 官方 mappings        | 同一 version JSON 的 `downloads.client_mappings` 为 `null`。                                                                                                                                                                                                                                                                                                      | Mojang 在这条元数据中没有交付 client mappings。                                     | 不存在任何社区 mappings，也不构成自行推定映射正确的许可。                        |
| 固定 Git object 可达 | 对 `https://github.com/jacobo-mc/mc_b1.7.3_release.git` 的只读 ref advertisement 显示 `main`/`HEAD` 都指向 `740c583…`；GitHub 的 [固定 commit 页](https://github.com/jacobo-mc/mc_b1.7.3_release/commit/740c583901e1ff1150e9ef37e37dab5bc0e4f807) 亦可读。                                                                                                        | 该 SHA 是当前公开仓库可定位的 Git 提交，后续 main 漂移不会改变固定地址。            | 该 Git 提交是从官方 jar 产生，或有 Mojang 授权。                                 |
| 该提交的内容范围     | GitHub commit 页显示提交名为 `Update LICENSE`、一个 parent `ce969e9…`、仅一个文件、`+1/-1`；改动是 LICENSE 的版权行。                                                                                                                                                                                                                                             | 选择这个提交不会改变相邻提交中的 Java 行为代码；它固定的是一个许可证编辑后的 tree。 | Java tree 的来源、反编译工具/版本、字节码相等性，或许可证声明本身正确。          |
| 仓库自我声明         | 固定 [README](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/README.md) 明称是“reconstructed code and assets”、仅供 reference；固定 [LICENSE](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/LICENSE) 自称 MIT。                                                      | 作者自称此仓库为重构参考材料，且该 tree 带有该许可证文本。                          | 它不是原始源码；声明不能建立从 Mojang 下载物到重构 tree 的密码学、版权或方法链。 |
| 人工编辑迹象         | [RecipesArmor.java](https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RecipesArmor.java#L11-L14) 含非功能性 `Test` 注释；固定提交本身还人工改写了版权行。                                                                                                                    | 至少存在人工编辑/整理的可见痕迹，不能将 tree 当作未经人工处理的原始反编译输出。     | 该注释改变运行时行为，或可据此量化/定位所有其他人工补丁。                        |

## 未形成的证据链

本次只读检查未发现以下材料的可核验引用；这不是证明它们绝不存在，而是本次不能把它们写为已具备。GitHub API 在读取完整 tree 时返回 HTTP 403；本次没有 clone 含潜在原版资产的整个仓库，因此没有把“有限可读文件未见”夸大为“仓库全树不存在”。

1. 取得该官方 SHA-1 jar 的记录、内容哈希复算记录，或 jar 与本 Git tree 的关联证明。
2. 反编译器名称/版本/命令、输入 jar SHA-1、输出 tree SHA-256、去混淆 mappings、重命名规则和每类/每方法映射清单。
3. 可从官方 jar 独立重建/比较的 class-file hash、方法 CFG/字节码 hash，或被复核的逐方法差异清单。
4. 对人为补丁、修复、格式化和资产替换的完整 diff/理由，而非仅 README 和 LICENSE 自我声明。
5. Mojang 对该 GitHub 仓库、其 LICENSE 或其代码/资产再分发的授权证明。

特别注意：官方 manifest 中的 `43db…` 只标识 launcher 下载的二进制；Git commit 的 SHA-1 只标识 Git object。这是两种不同对象、不同哈希域。相同“SHA-1”算法名称不允许把它们关联，更不能从 Git tree 反推 jar 相等。

## 独立资料交叉检索

[RetroMCP-Java v1.2](https://github.com/MCPHackers/RetroMCP-Java/releases/tag/v1.2) 提供可固定版本的反编译工具及补丁流程；其发布说明没有给出“官方 `43db…` jar → 本合同所用 `740c583…` Java tree”的产物哈希或逐方法映射。[theorzr/mc173](https://github.com/theorzr/mc173) 是另一个 b1.7.3 Rust 实现，但自称仍在开发，不能当官方 oracle。[Technical Beta Wiki](https://pixelbrush.dev/beta-wiki/introduction) 是辅助技术资料，其项目定位也不能替代官方字节码来源链。交叉检索未找到独立证明，因此**未提升任何一条候选 expected 的证据等级**；这些链接仅是可继续核对的线索，不是额外的 1:1 背书。

## 对现有合同的影响

| 合同用途                                           | 该来源可否支持                          | 所需表述                                                               |
| -------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| 将配方/常量/控制流列为待测候选                     | 可以，低置信静态候选                    | `SOURCE_CANDIDATE`，附固定 URL、commit 和文件/方法行；不得称原版真值。 |
| 从该仓库读取源码并生成内部不含原文的大纲/ID/预期表 | 可以，若仅保留必要事实且不复制源码/资产 | 记录为“重构源码候选提取”。                                             |
| 声称 client SHA-1 对应这些 Java 方法               | 不可以                                  | 缺 jar→decompile→mapping→method 的可核验链。                           |
| 以该仓库授权复制原版代码/资产或发布派生物          | 不可以                                  | 许可证文本和作者声明不足以替代权利审查。                               |
| 作为全局冻结、实现准出或 1:1 parity 的唯一来源     | 不可以                                  | 来源身份、方法映射和可执行验证均未闭合。                               |

这也解释了为什么即使配方登记的静态审计已能逐项定位，仍不足以冻结整份合同：静态候选可缩小测试空间，却没有证明候选与官方 comparator 相同；世界生成、实体 AI、物理、边界 tick 和 UI 输入等跨方法行为更不能由它单独推出。

## 最小升级路径与停止线

升级不是本任务已授权动作。若未来取得明确的法律/业务授权，建议按以下顺序保留可复核的派生证据，而不是提交 jar、反编译源码或资产：

1. 在获授权的隔离环境内，取得官方 manifest 指向的客户端并复算 SHA-1，要求等于 `43db9b498cb67058d2e12d394e6507722e71bb45`；只保存哈希、工具版本、时间和授权记录。
2. 固定反编译器、版本、输入 hash、命令和 mappings；产生源码/类文件的 tree/hash 清单，但不把原文、jar、类文件或资产带入 Seedlands。
3. 对合同实际用到的每个类/方法，生成可审阅的“官方 jar method identity → mapping → 候选 source 方法”的映射和差异报告；有任何人工补丁/不一致时登记为冲突，不做静默择优。
4. 只在合法隔离环境执行经过固定夹具的行为对照；把输入、初态、观测和结果 hash 带回合同，仍不导入原版材料。

在第 1–3 步完成前，停止任何“静态候选已等于官方源码”的声明；在第 4 步完成前，停止任何“实现与原版行为相同”的声明。若这些步骤无法获得授权或来源，整份合同保持 `REJECT_FREEZE`，并将重构仓库降为研究线索而非验收 comparator。
