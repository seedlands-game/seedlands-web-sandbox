# Close12 格式收口证据

阶段：`V2-ARRIVAL-DURING-AIM-CLOSE-12-FORMAT-CLOSURE`

状态：TYPE_ONLY_FORMAT_STATIC_GREEN。Close12 行为 SOURCE8/MANIFEST30/delivery 与八个 SOURCE 原件已在编辑前复制到
`prior-release/` 并逐项 `cmp`；归档身份分别保持
`c75666b03c3201b58fbd9d8a9e03f971ffb3f9d8716cfb24f3d2723ef4da4f9b`、
`a8f5d291fcb5da489b2c554ab6a52425573e1ff239f53bcec73dcf177952c8ed`、
`f01dbc717f2640855db38aeb81c8fc93845af8128fd77ba173bda3286353e019`。

## 修正

- Close12 初版确实在 `walkTo` 新增多处 inline `prettier-ignore` 并压平控制流；未修改 `.prettierignore` 不等于没有
  增加格式豁免。旧 delivery 的 `prettierIgnoreChanged:false` 已纠正为明确区分全局 ignore 文件和 inline suppression，
  且标记旧格式 PASS 不证明正常格式达标。
- `ClassicSnapshot` 原类型声明完整移动到同目录 `harness-snapshot.ts`。新文件只 import type `Point`；`harness.ts`
  使用 `import type` 并 `export type` 同名重导出，所有既有消费者的 import 面不变，不形成 runtime import/cycle。
- `walkTo` 恢复普通 Prettier 格式，不移动函数、不改 typed handoff、default false/omitted、true deadline、snapshot 或
  `Date.now()` 调用次序。当前 `harness.ts` 467 物理行；本片新增 inline suppression 为 0，原类型块 suppression 被移除，
  仅保留 baseline 已有的两个无关 suppression。
- `docs/code-map.md` 窄增一条测试侧类型职责映射；长期文档变化仅源于新增 type-only 文件，不代表生产架构变化。

## 验证

- prior-release：三份身份及八个 SOURCE 原件在复制时逐项 `cmp` PASS，当前归档八项 hash 也匹配旧 SOURCE manifest。
- `type-equivalence-release`：旧/新 `ClassicSnapshot` TypeScript AST hash 均为
  `f2a9df7b26b09b33cfde8a2eb6217153ec9898b741001f95501dc7f496596df3`；去类型后经 Prettier 规范化的 runtime JS hash
  均为 `a36af5074274ffe5897f3037b1d67df0022d477dc7d222e8b40b940e9eac8af7`。baseline/current inline suppression
  计数为 baseline 3、Close12 prior release 9、当前 2，当前 diff 新增为 0；runtime import 为 0，type
  import/re-export 为 true。
- Classic test types、root test types、六个 TS ESLint 和精确 Prettier/scoped diff 均 PASS。Close12 已通过的
  `13 files / 138 tests` 保持有效；本片仅 type-only 拆分与格式恢复，按授权未机械重跑。
- 首次 inline shell verifier 未启动；其后五次中间 verifier 因把格式 trivia 纳入 emitted 文本/AST 比较或脚本初始化
  次序错误而 FAIL，原 stdout/window 全部保留。最终 `type-equivalence-08` 使用 TypeScript 去类型并经 Prettier 规范化
  后比较 runtime JS，PASS。它们不代表产品或行为测试失败。

Browser21 仍为正式 FAIL，第一格 wood pickup PASS、后续 V2 NOT REACHED；Browser19 首 iron inventory pickup 仍
NOT PROVEN。本阶段未运行测试、build、Browser22、Cua、devserver、CI、Git/index/push、deploy 或 merge。
