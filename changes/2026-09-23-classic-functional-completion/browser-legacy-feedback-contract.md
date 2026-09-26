# Browser 旧存档来源失败反馈合同

状态：实施合同。只覆盖 Browser 无可信来源的 Gameplay V1–V3；不修改 stdlib lineage guard、Classic predecessor、数据库或 checkpoint schema。

## 行为

1. Browser 从本地 persistence 或 application checkpoint 读取 Gameplay snapshot 时，只在对象自身的 data property `version` 精确为 `1 | 2 | 3` 且没有可信宿主来源时产生 `LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN`。
2. `null`、V4及其他输入不由该分类器重写；V4继续使用内嵌 composition，一般格式/权限/运行时错误继续走原错误。
3. typed code沿现有 Worker字符串错误通道传递；客户端只按精确 code前缀映射，不通过英文 substring归类。
4. 启动失败回到现有世界列表，显示：“无法确认此旧存档的玩法版本，原存档未修改。可返回世界列表，保留旧档并使用其他种子创建新世界。”
5. application checkpoint导入在候选 runtime和持久化替换前拒绝，显示同一句中文；active world、IndexedDB record/chunks和本地暂停状态不因拒绝改变。
6. 不自动创建、覆盖或删除世界；尤其不能用同 seed“创建当前世界”，因为 `worldId = generatorVersion + seed` 可能与现有record碰撞。

## RED

- 纯分类：V1/V2/V3产生精确 code；V4/null/畸形对象不误判；相似英文错误不是该类型。
- 启动 UI state：typed错误映射为冻结中文，一般错误仍保留原反馈。
- 导入 UI state：公开 checkpoint port返回typed错误时显示冻结中文，调用前后真实 current world identity不变；一般错误仍使用既有兜底。
- Browser persistence：公开 `replaceFrozenSnapshot()`失败时 seed/worldId与已有缓存不变；后续合法replace仍成功。

## 非目标

- 不给无标记record回填 identity，不为V1–V3使用当前 identity，不新增 `gameplayProvenance`。
- 不修改数据库、Pack、stdlib guard、Classic migration、媒体、浏览器视觉或唯一Cua旅程。
