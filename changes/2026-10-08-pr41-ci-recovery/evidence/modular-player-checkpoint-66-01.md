# Modular 正常玩家方块 checkpoint66

父提交 da2a2ed6c6df162efc1c4ccd8a5a0e456d1c9c42；base fba4486e433c145db658f6b1598b70c47f759c8a。此记录是构建前修复组 checkpoint，不是完整 PR 准出。

## 问题与改动

Task127 exact Pack 的 Authority mode 命令在 task127-authority-run-04.log 返回 OPERATION_UNKNOWN。仅在测试组合补充标准 Mode/Ruleset 后，正常 place 在 task127-authority-run-06.log 返回 Unknown Block rule voxel: 0。这两个失败属于不同组合，后者未到达 occupied/break 断言；最初 HeadlessSession 的安全出生失败保留为 setup failure，根因尚未定位。全部原日志在 /workspace/pr41-recovery-20261008-fixtures-01，未覆写。

实际 sample:modular-world 现显式注册标准 Mode/Ruleset 与自有 replaceable Air rule；物品 sample:sentinel-glass、storage voxel500、worldgen、hardness/drop 和材质保持。scripts/product-pack-admissions.mjs 原 alternativePermissions 已允许对应 mode/ruleset，不修改安全准入或扩大 grants。新增测试移除全部临时补充模块，仅装实际 Pack，通过正式 Authority 玩家命令和 performAction；可信测试组合摘要不充当产物字节验证。

原唯一 Modular 90 秒 smoke 改用正常背包/创造目录选择自有物品、PointerLock 真实输入、挖掘 [0,64,0]、放置 [0,65,1] 与 reload 两个 voxel oracle。先移离一层地板后挖掘；成功动作无 Harness world 写入，flushSave 只存档，Harness setVoxelAt 仅在已完成验收后的残留清理。原 seed、low、WebGL2、Wasm/SIMD、Pack lock、Authority、compute 和加载/恢复断言保持。不扩整体或原局部时限，不改 runner/协议/物理/renderer。

## 已执行与未执行

Root modular-authority-regression-66-01.log 实际 EXIT0：两文件 5 项 PASS，包括新玩家放置、占用目标拒绝无部分写入、挖掘，以及既有 worldgen/光照定义/Actor checkpoint 合同。该定向结果绑定当前候选工作树，不移植为旧 SHA 或精确最终 SHA 的产品验收。完整 verify:static:ci 实际 EXIT0（格式/冻结证据/路径/lint、全生产及测试类型、Svelte0/0、66项ESLint规则、15项CI合同）；新增两份文档在其格式阶段之后写入，并已单独 Prettier 验证。新 identified Modular build、唯一浏览器真实输入及精确远端 CI 待验。构建时必须明确 SEEDLANDS_PLAYBOOK=modular-world，不使用 Classic artifact 冒充。

只追加新玩家测试到原 headless 选择，无删除/skip/断言放宽。Browser65 已失败，原日志与回执完整保留，详见独立终态记录；全 Classic C0–C5/V1–V4/death/save/194、统一 lighting、正式 transport/非空 legacy V4、Modular 其他玩法全链与组合整帧性能仍未准出。没有 whole-frame 性能收益声明。

长期 docs baseline 不变：复用现有 Pack 声明和正常 Action 合同，不新增协议或架构。最新真实额度 21:10 UTC 剩83%、5d5h后重置；21:50附近已请求更新真实 UI 读数，约60%停止线保持，不估算 token/credits 百分比。

## 后续集成检查

扩大七文件回归首次实际38 PASS/7 FAIL（modular-mode-block-regression-66-01.log）：旧Classic Mode两份组合夹具遗漏Pack资源。补齐声明资源后实际40 PASS/5 FAIL（66-02）：registered-mode夹具缺Media loaded-cell端口。补齐保持原known floor/unknown null语义后仍5 FAIL/3 PASS（modular-mode-host-regression-66-03）：Structure构造缺batch port。补齐会抛unexpected batch edit的窄端口后，原registered-mode五项实际PASS/EXIT0（modular-mode-regression-66-04），权限拒绝/unknown landing/reentry/queue/restore断言保留；mode-command-host三项在66-02与66-03均PASS。其余五文件37项66-02通过，复用这些未变化的结果，不宣称同次45项运行全绿。无生产门禁削弱。

三份新增headless选择也进入tsconfig.classic-tests.include。首次delta类型检查发现sample Pack既有faceMaterials readonly number[]不满足六面tuple（modular-static-delta-66-01.log EXIT2），两个数组增加as const不改变数值；最终定向eslint、完整classic-tests类型及受改格式均实际EXIT0（modular-static-delta-66-02.log）。完整static的先前结果仅覆盖当时源码，delta结果补齐后续变化；未重复全仓static或全headless。

21:54 UTC CI65自然终态：五项SUCCESS，Chromium FAIL，部署SKIP。实际原日志显示两次主旅程900秒都在V2的waitForEquipmentSnapshot→committedPointer→placeWholeStack/placeOneEach→craftArmor→prepareCraftedIronArmor耗尽，spec303；不是之前CI64的C4返回路线。Visual1.5min PASS、Modular SKIP。步骤耗时行不当作V2完成证据。私有ci65-chromium-errors-01.log留存安全摘录；GitHub原run37992680474保留完整日志/上传trace。
