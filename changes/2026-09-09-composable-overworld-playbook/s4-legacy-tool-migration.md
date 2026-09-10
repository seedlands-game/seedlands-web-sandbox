# S4 旧工具耐久迁移

状态：Implementing，细化 D6/T12 的一次性迁移。

只在 GameplaySnapshot V1/V2/V3 的脱离 owner 迁移分支，对已登记物品的玩家库存和世界掉落 stack 使用 initialize-at-max：旧工具缺 instance 时按当前匹配定义的 max 创建；原有合法 instance 原样保留。V4 严格要求完整实例，不能再补满；未知物品、非法数量、坏耐久及非耐久物品附实例仍拒绝。当前没有 V1–V3 NPC 库存格式，不虚构迁移数据。

记录沿既有 sourceVersion / restoredGameplayVersion 保留旧版本来源；输出 V4 中的显式实例值记录迁移结果，后续读取按 V4 处理而不重复补满。当前无发布的本期 V4 旧包升级义务；不绕过 composition lock/摘要检查。

RED：三种旧版本各自带无 instance 的工具库存与掉落，当前严格 registry 恢复失败；迁移后都为指定 max，调用方快照不变。再次保存为 V4、耐久变低后重读保持低值；V4 缺实例仍拒绝。非法旧 stack 不会被自动修复。
