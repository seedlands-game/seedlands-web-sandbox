# V2 Equipment Web UI 合同

阶段：`V2-EQUIPMENT-WEB-UI-01`（I2.2a）
状态：fixture、组件行为与静态验证完成；尚未提交，不代表真实鼠标、Browser/Cua 或完整 V2 GREEN。

## 数据与呈现

- `AuthorityGameplayView.inventory.armor` 是唯一装备输入。`BrowserGameplay` 必须把该已提交投影传给
  `projectGameplayUi`；UI 不维护第二份 equipment state，也不乐观改 bag、cursor、crafting 或 armor。
- 固定复用 `@seedlands/stdlib/mod-api` 的 `ARMOR_SLOTS` / `ArmorSlot`，顺序为 helmet、chestplate、leggings、
  boots；不使用 Classic item ID switch 或跨包私有 import。
- shell projection 为四槽生成 detached item presentation。非空槽与 bag 共用 item definition，保留
  itemId/count/name/stackLimit 和 instance durability current/max；空槽显示对应的头盔、胸甲、护腿或靴子
  槽型，而不是无类型“空槽位”。调用方后续修改 Authority 输入不得改变已发布 UI。
- `inventory-crafting.svelte` 只在正式 inventory-pointer 路由可用时显示装备区：survival 背包显示；creative
  无 station 时仍显示既有 catalog、不自行获得 equip 特权；任意模式打开 station 时沿既有 station pointer
  context 显示。四槽复用 `InventorySlot` 图标、数量、tooltip 与耐久表现。

## 手势与队列

- equipment 地址为 `{ kind: 'equipment', slot: ArmorSlot }`。click 左/右键、Shift quick-move、数字键
  hotbar swap 可生成 exact equipment slot command，并继续通过唯一 `BrowserInventoryPointer`。
- distribute 的 targets 只允许 inventory/crafting/station，拖过 equipment 不加入 preview 或 command；collect
  source 同样排除 equipment。equipment 双击不得发送 collect，回落为普通 click 语义。Web adapter 对手工
  构造的非法 bulk equipment command 再次 fail closed，不调用 Authority。
- queue 在每项实际出队时读取最新 `inventory.revision` 与当前 station revision；actor lifetime 仍绑定首次
  send，station identity 必须保持。equipment 操作失败只走既有反馈并 refresh，不调用 changed，不改本地
  presentation；close 的 station/equipment origin 结算与最多一次 stale rebase 保持现状。
- mode、actor identity、inventory/station context 切换继续取消未开始的 Svelte gesture 或拒绝旧 actor queue；
  普通 committed revision 更新不取消连续手势，由 queue 为后续动作读取最新 revision。

## 测试、预算与停止线

- RED 必须由现有 Web Vitest 配置进入行为断言：committed armor 未出现在 projection/SSR、gesture 生成
  equipment collect/distribute、adapter 转发非法 bulk command。不得以 missing import、collection 或类型失败
  代替。
- GREEN 覆盖四槽 projection/脱别名、空槽型与非空 durability、click/quick-move/hotbar、非法 bulk 拒绝、
  queue 最新 revision/actor/station 门禁、failure/close 以及 creative/station 可见性；现有 UI/projector/queue
  回归保持。组件/静态通过不等于真实鼠标或产品 Browser/Cua GREEN。
- 传统工程量 0.5-1 PD；AI 连续墙钟 2-4 小时，硬上限 6 小时；120% 保守建议 0.6-1.2 PD、2.4-4.8
  AI 小时。credits、API 等价费用、费率、当前额度分母与占比均 unknown。
- 若 Authority projection 缺失 armor、正式 action 不能接收 equipment、或需要修改 stdlib/protocol/Classic
  content 才能闭环，停在可复现 RED 交 root 裁决；不越域实施。

## Close-02 收口

- `creative-mode-ui.test.ts` 的 `Game` fixture 必须实现 production `ApplicationShell` 构造时已调用的
  `setMouseSensitivity`，完整文件与 retained `ui-bridge` 回归必须通过；不得仅跑 projection 子项隐藏 setup
  failure。
- 本阶段新增的 `inventoryOpen` 字段前 `prettier-ignore` 与 `refresh()` 内压行声明必须撤销。为满足既有
  `max-lines`，projector 接受一个现有 Authority `inventoryView` 只读对象，替代四个平行 inventory 元数据
  参数；不新增状态 owner、兼容 fallback 或公共协议。
- Close-02 后需新 source identity/artifact 才能做 Browser/Cua 验收；上一 release 的 manifests 与 evidence
  原字节保留在 `evidence/v2-equipment-web-ui-close-02/BEFORE-CLOSE-02-*`。
