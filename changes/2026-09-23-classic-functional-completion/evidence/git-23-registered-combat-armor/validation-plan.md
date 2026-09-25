# GIT-23 Registered Combat Armor 组合验证计划

## 冻结输入

- 基线 HEAD/upstream/origin/`ls-remote`：`5a835ab88454e8506db986c73187c695df1263ea`；index 为空。
- 生产：`registered-combat-runtime.ts` SHA-256 `f20783c2...65fa`，`prepared-combat-damage.ts`
  `5380ab8f...28c3`。
- 测试：`registered-combat-armor.test.ts` `177a5e86...cacc`。
- spec `c9639d13...914e`，合同 `8fc213bf...c053`，证据 `ff31e01e...a2ea`。
- 历史 evidence manifest `13ef2fdf...2522`（52 entries），SOURCE manifest `6cc7868f...bb3b`
  （7 entries）。`armor-equipment.ts` `819282b1...2f41` 是复用依赖，不作为本批修改。

## 隔离与门禁

- 从当前 HEAD 创建 detached 临时树，只覆盖上述冻结文件、combat evidence目录和本批状态/证据。内部
  `@seedlands/*` 必须解析到临时树，第三方 store可复用。
- 锁内串行验证：registered combat armor `8/8`；registered combat + prepared damage `22/22`；prepared
  request/frontier/effects `14/14`；Classic armor `6/6`；equipment revision/pointer组合 `43/43`。
- shared equipment death仅运行第三项，预期 `1 failed / 2 skipped` 且失败仍为死亡后armor保留；保留exit 1，
  不改测试、不宣称death GREEN。
- stdlib/root test/Classic types、全部 staged TS ESLint、可编辑format和scoped diff须PASS。所有命令使用默认
  `benchmark-window`，Vitest `--maxWorkers=1`。不运行Web pointer9、restore4、build、Browser、Cua或CI。

## 提交边界

第一笔只提交两个生产文件、一个测试、`spec.md`和combat合同；第二笔提交combat evidence、原52-file证据目录、
本批证据与tasks/state。不得暂存其他production、`mod-api.ts`、Pack、Lighting、transport、README、package、CI
或GIT-22外文件。自然hooks；push并更新PR #41后只读回当前gate，不等待。
