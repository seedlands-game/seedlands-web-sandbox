# S4 角色档案与可选初始生态补充合同

## 范围与行为

- `defineContentModule` 公开接收有界的 `actorProfiles`、可选 `defaultPlayerMeleeDefinitionId` 与可选 `starterEcology`。角色档案只复用现有 `ActorArchetype`、`ActorBehavior` 与导航数值，不扩展通用 AI 框架。
- 每个角色档案明确实体类型、最大生命、移动速度、感知范围、可选近战定义与可选死亡掉落。引用的物品和近战定义必须属于同一世界内容。
- `starterEcology` 明确三个既有布局槽位的角色、初始食物以及稳定 ID 前缀。只有声明该配置的 Playbook 才生成营地、自然编辑、POI、角色和食物。
- 装配在世界创建前完成校验，并深复制、冻结公开配置。调用方在装配后修改输入对象不得改变活动世界。
- Overworld Playbook 显式登记现有 grazer、night-stalker、settler 数值、玩家徒手近战和 starter ecology，保持当前第一方体验。未组合旧入口使用同一份显式 Overworld 兼容内容。
- 组合世界没有 Combat 时，玩家或自主角色攻击返回 `combat-unavailable`，不得回落到 `unarmed`、`night-stalker-claw` 或旧 CombatRuntime；没有 Needs 时不得运行旧自主角色饥饿累加。

## RED / GREEN

1. 自定义 Playbook 只登记内容和一个角色档案，不登记 Combat、Needs 或 starter ecology。Authority 新世界只产生玩家；手工产生的角色使用档案中的实体类型和生命；推进规则不改变旧 hunger；攻击不造成伤害。
2. 装配拒绝未知死亡掉落物品、未知角色近战和未知默认玩家近战。装配后修改输入档案、掉落或 ecology 食物不改变解析后的世界内容。
3. Overworld 装配仍得到三个既有角色档案、`unarmed` 默认玩家近战与现有 starter ecology；初始化后仍有三类角色、berry 与 camp。

## 验收边界

- 聚焦 Vitest 覆盖真实 `AuthorityRuntime`、`GameServer` 和组合装配入口。
- 对触及文件运行定向 ESLint 与 TypeScript 检查；完整静态检查、构建和 Browser 旅程由根任务串行执行。
- 不改变 ActorArchetype 集合、行为决策、存档 schema、世界生成算法或 UI。
