# UI 独立审阅：首次快照

## 对象与范围

- Base / merge-base：`14aa2e0c23bd42c8f844adc80f5f8b9b0d898f4b`。
- Head：`559a6518d016f8daba174f0a6d5fa6738c2e6a36`，不可变临时 Git 提交，未移动功能分支。
- 请求 Sol/xhigh，只读独立 reviewer；实际计费与 token 回显 unknown。
- 完整覆盖冻结快照的 12 个 `apps/web` 文件、4 个 `tests/client` 文件和本 change 的 Playwright 文件。Core 只作为邻接合同读取，完整 Core 审阅另行冻结。
- 规则来自 base tree 的 AGENTS 与相关 docs；生产文件来自 head tree，未读取漂移工作区来拼接结论。

## 代码说明与阅读顺序

槽位事件进入 `InventoryPointerGestures`，按串行队列等待拿起响应后再处理移动/释放。`BrowserInventoryPointer` 绑定 Actor 和容器身份，在实际发送时读取受影响库存 revision；Authority 返回后投影槽位和游标，客户端只派生分配预览。

建议依次读 `browser-inventory-pointer.ts`、`inventory-pointer-gestures.ts`、`inventory-crafting.svelte` 与 `inventory-slot.svelte`、`station-ui-projector.ts` 与 `station-panel.svelte`，最后沿 BrowserGameplay → Game → bootstrap → PlayerController 核对输入边界及单测/Browser 用例。

## 证据与人工复核

Reviewer 未运行测试、构建或服务器。Root 提供的 Browser 进度不是 reviewer 独立运行证据，首次快照也尚未覆盖下面三个反例。最值得人工复核的是满背包关闭工位来源游标、满背包普通结果槽制作，以及模式响应返回前再次点击库存。人工手感与最终产品验收仍未完成。

## 独立审阅 Findings

结论：`NEEDS_FIXES`，3 个高置信 P1；以下行号均绑定 `559a651`。

1. **P1：关闭不带原工位上下文。** `browser-inventory-pointer.ts:42` 排除了所有 close 的 station 引用；从箱子/工作台/炉体拿起后关闭只能归包或掉落，无法优先回到仍可访问的原格，违反关闭合同。建议携带可达且身份匹配的原工位引用/revision；失效后才执行 Actor 结算。
2. **P1：满背包错误禁用可进入游标的结果。** `station-panel.svelte:24`、`:61` 和 `station-ui-projector.ts:58` 用旧的 `craftableRecipeIds` 判定结果；邻接投影按背包输出容量生成该列表，但普通 pointer craft 应输出到游标。建议独立投影网格匹配结果，Shift 批量仍由权威端校验背包空间。
3. **P1：模式响应前解除输入锁。** `inventory-crafting.svelte:148`、`:150`、`ui-contracts.ts:141` 与 `browser-gameplay.ts:279` 吞掉模式命令 Promise，旧生存界面可在创造模式提交后再次发指针拿起请求，生成被创造界面隐藏的游标。建议等待模式权威响应与投影后再解锁，期间拒绝新槽位输入。

覆盖注：首次冻结 UI 文件集已读完；Core 与后续修复不包含在本报告，必须另行复核。
