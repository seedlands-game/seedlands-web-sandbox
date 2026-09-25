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
- 实际活跃墙钟约 0.7 小时，低于 AI 2-4 小时正常预算与 6 小时硬上限；credits、API 等价费用、费率、
  当前额度分母与占比均 unknown。
