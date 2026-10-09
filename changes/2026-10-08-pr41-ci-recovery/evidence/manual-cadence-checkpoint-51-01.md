# 显式 system cadence 与精确 V4 兼容

范围为 `ecb7213f3c0a1941aef14ec5a972189aa175e0eb` 后的 checkpoint51。新增通用 `manual` cadence：正式 Host system binding 仍须已有 resource/principal 授权，lifecycle 不自动调用、不计入 scheduled operation 预算，snapshot remainder 恒为零。manual interval、自身 before/after 和 scheduled→manual 依赖拒绝；旧 interval/every-advance 合同保持。长期可组合架构文档补充此合同；没有增加 Host grants、输入字段或运输运动实现。

## RED 与身份兼容

真实 assembly RED 拒绝 unknown cadence；最终 stdlib 新夹具 6/6 PASS，实际 registered binding/invoke、权限拒绝、无自动调用、snapshot 零写拒绝、依赖/身份反例和旧 cadence 对照均覆盖。原 lifecycle 8/8 PASS。

默认 Classic Pack 字节不变假设实际 FAIL：精确前驱 entry 为 `c1ef197e7fea7248a65488494881cbf84cbda77823d09291edf596183184da18`，初始 candidate 为 `8b732487aa1a0fa59f263480a4a64738e5f5a1836110e6914623b6f3692b1245`；差异来自 Pack 内嵌的身份解析器接受 manual。失败原样保留，扩展预注册后增加唯一完整前驱身份。

来源是精确前驱 Host 源码和 `loadVerifiedPackArtifacts` 校验过的生产 Pack。产物来自 build33/source `5d91421ecbd6a57ecc255f476cb41bb6614c236f`，但 Classic entry 实际逐字节等于精确 `ecb7213f` 重建 control；manifest、entry、每个 resource 的摘要/大小均由正式 loader 校验。真正创建 GameplayRuntime、spawn player 后导出原 V4，未手造 composition 或替换 digest。

原存档为 [pre-manual-v4-runtime-51-01.json](pre-manual-v4-runtime-51-01.json)，来源与摘要在 [receipt](pre-manual-v4-runtime-receipt-51-01.json)。源码常量保存这份独立实际 capture 的完整身份，只作为 V4 精确 predecessor，不使用宽泛版本/digest 匹配。当前默认 definitionMap 在实际候选恢复检查中与旧身份完全相同。

实际候选 Pack 首先 RED：旧 V4 被 composition 拒绝，原 active owner 不变。加入唯一前驱后，正式 loader 校验 candidate Pack entry `3bb6fb967fb270e97d1843892734863c64fdb20f3f3709ec18a04a7c782bcb33`，实际运行恢复 GREEN：完整保存实体、simulation、vehicles、lifeSkills、navigationItems、crops、finalEntities、progress、ruleset、moduleSchedule、media 保持；既有 issued-ID 防复用 fence 按原合同取并集。改变 entry digest 或 operation resource 均拒绝且 active snapshot 不变。

首次 GREEN 断言把 issued-ID 防复用并集误认为应逐字节等于旧集合，实际失败保留；核对既有 restore 合同后改为明确验证并集。此修正未改变生产 restore。候选 Node runtime bundle SHA256 为 `5d555cc8be8857b4f5ec28655b1d92d2d70741bab5cae27cafbe8f0b27c243bb`。原始 capture SHA256 为 `835b82f47fc1633da57db13420ed419f4bde872cfa22ce3736317df7a678b9a1`；tracked JSON 经 Prettier 排版，其独立字节摘要见 receipt。

## 验证边界

- stdlib 新夹具 6/6 PASS；原生命周期 8/8 PASS；Classic checkpoint 新旧两文件 12/12 PASS。新 Classic fixture 的 target 使用明确标注的 synthetic identity 隔离行为测试，不作为 production Pack 身份来源；真实 Pack 检查是上述独立 loader/runtime RED/GREEN。
- scoped ESLint、stdlib production types、root test types、Classic types PASS。误用不存在的 `packages/stdlib/tsconfig.test.json` 的命令 EXIT1 不算测试失败或 PASS；正确 root `tsconfig.test.json` EXIT0。
- 完整 `pnpm verify:static:ci` 实际 EXIT0：sealed evidence 5/5 字节保持，格式/路径/全仓 ESLint/全部生产与测试 types PASS，Svelte 0 errors/0 warnings，ESLint 规则 66/66、CI selector 14/14 PASS。
- 本组没有生产 app build、真实浏览器验收或性能 A/A/A/B；headless 兼容证明不代表产品可玩性。

独立原始输出在 `/workspace/pr41-recovery-20261008-root-01/manual-cadence-*51*` 和既有 Luna Task107 日志；保留有效 RED、原类型错误、无效 selector 首轮及真实 GREEN，未重写 sealed evidence。

## 已提交前驱的远端结果

精确 `ecb7213f` CI run `37930258389` 五项 SUCCESS；Chromium job `113819430659` CANCELLED，Cloudflare SKIPPED。推送下一组前已保存终态与原日志，不是本次 push 取消它。主旅程首轮触及原 900000ms，在铁资源路线操作时报告 Pointer Lock 丢失；不能单凭收尾错误宣称 Pointer Lock 独立根因。retry 在 V1 新放置门的跨 Chunk mesh 方向原 5 秒断言失败。报告汇总 1 failed / 1 passed / 1 skipped、24.4 分钟后 job 被取消；此轮未通过，C5 未完成。

所有浏览器时限、断言、重试、画质与 workflow 保持。下一步仍须正式运输运动/碰撞、Classic/Modular 消费者、完整资源链/save/restore、原浏览器旅程和组合整帧性能验收；PR 未达到可合入状态。
