# S4 配方的工具实例状态

状态：Implementing；细化已批准物品实例、合成与木石铁成长合同。

ModRecipe 的物品数量条目支持与 ItemStack 相同的可选 instance。注册、存储 ID 映射、每世界配方 registry 和真实合成必须完整保留经物品定义校验的耐久；不能在别名映射时删掉实例，也不能让调用方修改数组或嵌套 instance 改变冻结配方。注册内容保持纯定义，实例合法性仍由该世界 items registry 决定。

新的工具配方明确声明满耐久产物。缺 instance、超过 max、非耐久物品带 instance、非法数量在装配完成前拒绝。不会为普通非法输入自动补满耐久；旧版本存档的一次性迁移由版本迁移入口负责。

可执行 RED：公开 facade 注册自定义耐久工具配方，经实际 composition 和 Inventory craft 产生指定耐久；更改源配方嵌套 instance 后，composition/recipe/craft 保持原值；非法实例明确拒绝。既有普通无实例配方保持通过。

工位与炉体沿用同一实例身份：配方输入不仅匹配 itemId，还匹配声明的耐久实例；不同耐久不能代替原料。炉体定义需复制并冻结嵌套 instance，外部别名不能改变烧制结果。RED 覆盖有序/无序工位输入、炉体输入替换和定义别名；拒绝不消费原料。
