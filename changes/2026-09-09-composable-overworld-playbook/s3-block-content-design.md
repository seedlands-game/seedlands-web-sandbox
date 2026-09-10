# S3 方块定义归属与实际查询

状态：Implementing。细化 D1 / D2 / T03，不修改现有数值、掉落或生成器映射。

默认硬度、可替换性、工具类型与掉落定义归 Overworld Pack；标准 Block Rules 必须显式接收定义，不能在缺配置时隐式加载默认玩法。规则构造时继续严格验证、复制并冻结定义。公开的 Block Rules capability 同时提供该世界实际使用的只读定义目录。

query-voxel-definitions 在已装配世界读取该世界的规则 capability；没有 provider 时沿既有错误路径明确拒绝，不返回第一方默认定义。旧未装配工程接口保留兼容查询，但复用 Overworld 的唯一内容源。

可执行 RED：两个实际 GameServer 装配不同石块硬度，命令查询必须返回各自定义；修改调用方数组/嵌套掉落不能改已装配定义；省略规则定义必须拒绝。默认目录的数值映射及行为不变。随后运行受影响单测、静态检查、构建和真实 Browser 回归。

## 本轮证据

两个实际 GameServer 返回各自 7 / 11 秒硬度，且构造后修改原数组/嵌套掉落不改变世界定义；省略 Block definitions 明确拒绝；未装配 Rules 的世界查询明确报 capability 缺失。前两项已取得执行 RED，三项 GREEN。默认数值与掉落保持原值。

与跨目标授权补丁同树完整 static 1632 passed / 4 skipped、build 分别通过。local-only 日志 `/tmp/seedlands-s3-block-content-red.log`、`/tmp/seedlands-s3-block-content-green2.log`；完整门禁路径见 [授权补充](s3-secondary-actor-permissions.md)。长期 docs baseline 更新代码地图中的第一方内容归属与真实查询来源；架构职责/产品路线没有变化。

最终同树 Browser 12/12（40.2s）通过，实际 ESM Pack 启动、原有采集合成与 mode/restore 保持正确；4173 已释放。上述证据是本切片准出，不是 S3–S6 全阶段交付。
