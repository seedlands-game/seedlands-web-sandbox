# V2 Equipment Web UI 证据

阶段：`V2-EQUIPMENT-WEB-UI-01`（I2.2a）
基线：`a39f7ba6d18b602305372093c43757be83a6125e`
状态：fixture、组件行为与静态验证完成；未暂存、未提交、未推送。

## 实施结果

- `BrowserGameplay` 每次刷新直接把 `AuthorityGameplayView.inventory.armor` 交给 UI projector。projector
  按公开 `ARMOR_SLOTS` 固定顺序生成 detached 四槽 presentation，不保存第二份 equipment 权威状态。
- 新的 `equipment-panel.svelte` 复用既有 `InventorySlot`，因此非空装备与 bag 使用同一 item icon、数量、
  tooltip 和 durability bar；四个空槽分别显示头盔、胸甲、护腿、靴子槽型。survival inventory 和已打开
  station 显示装备区，纯 creative catalog 不显示、不自行授予 equip 特权。
- UI slot 直接复用公开 `InventoryPointerSlotRef`。click 左右键、Shift quick-move 和数字键 hotbar swap 可携带
  exact equipment slot；DOM parser 只接受四个公开 armor slot。distribute/collect 的类型和 gesture runtime 均
  排除 equipment，Browser adapter 对手工构造的非法 bulk command 再 fail closed。
- `BrowserInventoryPointer` 仍是唯一写队列。合法 equipment command 在出队时读取最新 inventory/station
  revision，并绑定 send 时 actor/station identity；失败只反馈/refresh，不调用 changed。equipment-origin cursor
  close 保持既有结算，且不伪造 station context。
- 未修改 stdlib、protocol、Classic Pack、combat、death、Lighting、transport、Harness 或坐标/timeout。

## RED、GREEN 与回归

| 门禁                     | window                                           | 结果                                 | 证明边界                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 行为 RED                 | `v2-equipment-web-ui-red-01`                     | FAIL，4 files / 6 failed / 16 passed | projection/SSR 没有四槽，gesture 生成 equipment collect/distribute，adapter 转发非法 bulk；均进入行为断言                                                                            |
| 最终 UI/queue 矩阵       | `v2-equipment-web-ui-green-release`              | PASS，5 files / 33 tests             | committed/非 Classic projection 与脱别名、四槽 SSR/顺序/durability、click/quick-move/hotbar、parser、非法 bulk、queue revision/actor/station、failure/close、creative/station 可见性 |
| UI bridge 回归           | `v2-equipment-web-ui-bridge-regression-01`       | PASS，1 file / 6 tests               | retained shell reset/coalescing 保持                                                                                                                                                 |
| creative projection 回归 | `v2-equipment-web-ui-creative-projection-01`     | PASS，1 passed / 3 skipped           | 当前 world definitions 与 creative/survival inventory 分离；只定向 projection                                                                                                        |
| Web/Svelte types         | `v2-equipment-web-ui-web-types-release`          | PASS                                 | svelte-check 0 errors/0 warnings，Web TS/工具 TS 通过                                                                                                                                |
| root test types          | `v2-equipment-web-ui-root-test-types-release`    | PASS                                 | 最终测试字节                                                                                                                                                                         |
| Classic test types       | `v2-equipment-web-ui-classic-test-types-release` | PASS                                 | Web UI 类型变更对 Classic test 闭包兼容                                                                                                                                              |
| 定向 ESLint              | `v2-equipment-web-ui-eslint-frozen`              | PASS                                 | 最终行为文件；最终文档另做 static/diff                                                                                                                                               |
| 最终 static/diff         | `v2-equipment-web-ui-static-final`               | PASS                                 | 最终授权 TS/Svelte/MD 的 ESLint、Prettier 与 tracked/untracked whitespace                                                                                                            |
| retained 组合诊断        | `v2-equipment-web-ui-retained-regression-01`     | FAIL，1 failed / 9 passed            | `creative-mode-ui` 的既有 ApplicationShell fixture 缺并行新增的 `game.setMouseSensitivity`；本片不改该 fixture，其余该文件投影和 ui-bridge 均通过                                    |

中间失败全部保留：`green-01` 发现测试把 armor 放进 `player` 而非正式顶层 inventory projection；
`web-types-01` 发现 Svelte 对嵌套条件表达式的 slot union 未收窄，改为 exhaustively switched `itemAt`；
`eslint-01/02/03/final` 发现既有大组件超出 500 effective lines，随后把装备区抽成 82 行同职责组件，并
以现有 compact declaration 风格使 BrowserGameplay 回到规则内；未禁用 ESLint。`green-final2` 的两个失败
只是新增 close feedback 断言未清空同一测试中先前 click 的 mock 计数，隔离后 `green-final3` 及 release 均通过。

## 实际命令

所有正式命令都从仓库根目录执行，外层统一为：

```sh
SEEDLANDS_RESERVATION_RUN=<window> \
SEEDLANDS_RESERVATION_EVIDENCE=<evidence>/<name>-window.json.log \
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- <command>
```

关键 `<command>`：

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/gameplay-ui-projection.test.ts apps/web/tests/unit/client/inventory-crafting-ui.test.ts apps/web/tests/unit/client/creative-station-ui.test.ts apps/web/tests/unit/client/inventory-pointer-gestures.test.ts apps/web/tests/unit/client/browser-inventory-pointer.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/ui-bridge.test.ts --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/creative-mode-ui.test.ts -t 'uses per-world definitions' --maxWorkers=1
pnpm --filter @seedlands/web typecheck
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm typecheck:classic
pnpm exec eslint <本阶段 Web/测试文件>
pnpm exec prettier --check <本阶段 TS/Svelte/MD 文件>
```

每份 window receipt 包含实际 UTC、run/window ID、exit code 与机器采样；stdout 与 receipt 均以原字节保留，
最终 `MANIFEST.sha256` 固定全部原始文件和 source manifest。

## 未覆盖与交付边界

- 本阶段没有 browser lease，未运行 build、Browser、Cua、devserver、CI、完整 Web suite 或全产品旅程；
  因此只能宣称 fixture/component/static GREEN，真实鼠标与玩家可用性等待新 artifact 的唯一 Browser/Cua。
- wrong-slot、full-bag、stale revision 与 close settlement 在本层验证既有失败反馈/refresh/无 changed；服务端
  原子性来自已提交 pointer/revision/station 合同，不用 Web 单测替代。
- 长期 docs baseline 未更新：本片只把既有公开 equipment projection/action 接到当前 Web UI，没有改变跨层
  owner、公共协议或架构决策。
- 含 Close-02 的实际活跃墙钟约 0.9 小时，低于 AI 2-4 小时正常预算与 6 小时硬上限；credits、API 等价费用、费率、
  当前额度分母与占比均 unknown。

## Close-02 收口

`V2-EQUIPMENT-WEB-UI-CLOSE-02` 在不改变 equipment 行为合同的前提下关闭两个交付问题：

- `creative-mode-ui.test.ts` 的本地 `Game` mock 增加 production 构造函数已要求的 `setMouseSensitivity`。窗口
  `v2-equipment-web-ui-close02-retained-green` 为 PASS，完整 `creative-mode-ui + ui-bridge` 共 2 files / 10
  tests，不再以 1 passed / 3 skipped 掩盖旧 setup failure。
- 撤销本阶段曾加入 `browser-gameplay.ts` 的两个 `prettier-ignore`，恢复 `inventoryOpen` 与 `view/player` 正常
  声明。projector 直接接收现有 Authority `inventoryView`，由它统一读取 actor identity、armor、cursor 与
  matched crafting recipes；BrowserGameplay 因此净减少 3 行且定向 ESLint 继续通过，没有调低 max-lines。
- `v2-equipment-web-ui-close02-behavior-green`：PASS，5 files / 33 tests；覆盖原 equipment projection/UI/gesture/
  queue 闭包，证明 projector 参数收拢没有改变行为。
- `v2-equipment-web-ui-close02-web-types` 与 `v2-equipment-web-ui-close02-root-test-types`：均 PASS；
  `v2-equipment-web-ui-close02-static`：ESLint、Prettier 与 tracked diff PASS。Classic test types 沿用
  `v2-equipment-web-ui-classic-test-types-release`，因为 Close-02 只改 Web 内部 projector 输入与 Web unit mock，
  没有改变 Classic test dependency surface。
- 上一 release 的 `SOURCE-MANIFEST.sha256`、`MANIFEST.sha256` 与 evidence 正文已在修改前按原字节复制为
  `BEFORE-CLOSE-02-*`；其原 SHA 分别为
  `a80a60d1dd00411e20b968103c962d16c37cbbbb0b7df2604277ff5544de4399`、
  `bb62b90540b0fb068fe83491ff48a9fbf7009cc95af7ca2ac1a8b8ab89c76955`、
  `4b0226265857e7405f203c9503af37eb7151e0cf660dd5ed9ad0f846c2d57d36`。当时不存在独立 delivery 文件，
  因此没有伪造或补建历史 delivery。
- Close-02 仍未运行 build、Browser、Cua、devserver、CI 或完整 Web suite。由于 source 已变化，后续真实
  Browser/Cua 必须使用 954 提交并重新构建的新 identity artifact，不能复用旧 artifact。长期 docs baseline
  仍不更新：这是当前 change 内的 fixture 与 Web 内部职责收口，没有改变公共协议或架构 owner。

## GIT-25 隔离交付复验

从 HEAD `1f0dda0023fb68185ff2ad2a57a9e4aa01ec15ca` 精确暂存 CLOSE-02 SOURCE 中除本证据文档外的
17 个 Web 源码、测试、spec 与合同路径。staged patch SHA-256 为
`de9621344ed545e8abdedff312e8e310a88a16aa04fc04c8c8391b27c2f97746`，tree 为
`9f4eef3213db0ffb2ddf3086b4f7e5e92e6d8eb0`；临时 commit
`13d9dad193efb62dd8bc543f411cad331e028c5e` 只用于 detached 验证，不更新分支。

隔离树 `/private/tmp/seedlands-git25-ui` 的根与包级 `@seedlands/*` 均解析到该树自身，第三方
`.pnpm` store 复用，task-state 位于该树。复验结果：

| 门禁                             | window                                 | 结果                        |
| -------------------------------- | -------------------------------------- | --------------------------- |
| UI / pointer queue               | `cd2d5dcd-7d74-4f4f-9f22-a81ebd5584f0` | PASS，5 files / 33 tests    |
| creative mode / UI bridge        | `f472e6da-20e2-4c16-b59f-63ae1a10cf3a` | PASS，2 files / 10 tests    |
| Web/Svelte types                 | `446baf32-07a1-4d6c-95a3-3b34547df2c6` | PASS，0 errors / 0 warnings |
| root test types                  | `405afd90-88db-4e7e-b316-6369b80a6ac6` | PASS                        |
| Classic test types               | `45d9ed89-1d83-4151-b04f-4a5e2d09981b` | PASS                        |
| staged TS/Svelte ESLint          | `2a2d74d2-cbc8-47e3-84e3-7402e48824a7` | PASS                        |
| editable TS/Svelte/MD format     | `02192c26-d8b9-47d1-87c9-e1abab90569f` | PASS                        |
| baseline→临时 commit scoped diff | `68d04f65-dcf2-4a5d-83c3-2fb348ddbc74` | PASS                        |

第一批代码、测试、spec 与合同经自然 hooks 提交为
`ff17b4cc14d6650fe2156e559883c824464f5b5d`，commit tree
`9f4eef3213db0ffb2ddf3086b4f7e5e92e6d8eb0`，恰含 17 个冻结路径。旧
`v2-equipment-web-ui-01` 与 `v2-equipment-web-ui-close-02` manifests/raw 保持原字节；GIT-25 另建
metadata，不把旧 SOURCE 当作当前未提交工作树快照。

GIT-25 只准出静态、组件和 queue 行为。真实浏览器装备旅程、Cua、death producer、Classic death policy、
完整 V2 与 CI 均未验证。后续 BUILD02 只能证明该提交身份可构建和 artifact 可复验，不能替代真实装备交互。
