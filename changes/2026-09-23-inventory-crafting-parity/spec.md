# 背包合成一致性与图标边界

状态：Delivered。Classic 背包此前把完整库存当作无序快捷合成材料池，工作台则使用独立 3×3 网格配方；背包槽位图片还会按素材原始尺寸溢出。现已对齐经典 Minecraft：随身 2×2、工作台 3×3，共享同一配方目录与权威合成事务。

## 用户结果与硬约束

1. 背包中的物品图片必须完整限制在各自槽位内，不遮挡其他槽位或窗口。
2. 生存背包显示可实际放置物品的 2×2 合成网格和结果槽；工作台保持 3×3。
3. 两种界面消费同一份 Classic 网格配方目录；配方是否可用只由形状/原料能否放进当前网格决定，不再按“个人配方/工作台配方”分裂。
4. 配方匹配、扣料、产出、批量合成、光标、关闭归还、死亡/模式切换和存档恢复均由 Authority 单 owner 提交；客户端不直接改库存。
5. 旧 actor snapshot 缺少随身合成网格时迁移为空 2×2，不改变现有背包容量、物品 ID、工作台和存档世界 ABI。
6. 炉子仍是独立加工机制，不纳入 2×2/3×3 合成目录。

## RED 与验收

- Given 大尺寸 3D 缩略图，When 渲染背包或快捷栏槽位，Then 图片 `max-width/max-height` 不超过槽位内容盒且 `object-fit: contain`；当前截图为溢出窗口。
- Given 同一份 Classic 网格配方，When 打开背包或工作台，Then 2×2 只显示 footprint 不超过 2×2 的配方，3×3 显示全部；不存在只注册在某个 UI 的配方。
- Given 2×2 网格放入木板配方，When 点击结果，Then通过 inventory pointer 原子扣料并把结果放入 cursor/背包；关闭背包时网格和 cursor 均安全归还。
- Given 3×3 配方（镐、箱子或熔炉），When 在背包查看，Then不显示为可完成；When 在工作台按图摆放，Then正常匹配。
- Given legacy actor snapshot，When 恢复，Then新增 personal crafting grid 为空；Given 新 snapshot，When 保存恢复，Then四格内容保持且不会复制或丢失。

## 测试设计

1. stdlib 纯逻辑：2×2/3×3 shaped/shapeless footprint、匹配、扣料、结果容量、关闭归还和 legacy snapshot 迁移。
2. Classic 内容：完整 recipe ID 集合在共享网格目录中闭合，显式 3×3 图样覆盖对应通用配方且不重复。
3. Web：背包 SSR 包含 4 个 crafting slots、结果槽和共享配方书；工作台仍为 9 格；槽位图标 CSS 有确定尺寸与 contain。
4. Production：唯一 Classic spec 通过真实 pointer 将材料放入 2×2、取结果，并在工作台看到同一目录的 3×3 配方。

## 任务

- [x] 权威 actor-owned 2×2 crafting grid 与存档迁移。
- [x] inventory pointer 支持 personal crafting slots、结果与关闭结算。
- [x] Classic 单一网格配方目录及 2×2/3×3 footprint。
- [x] 背包 2×2 UI、共享配方书和图标尺寸修复。
- [x] 静态、确定性、production 浏览器与交付证据。

## 文档基线

本 change 不改变长期可组合玩法分层；交付时仅在源码职责新增稳定边界时更新 `docs/code-map.md`。
