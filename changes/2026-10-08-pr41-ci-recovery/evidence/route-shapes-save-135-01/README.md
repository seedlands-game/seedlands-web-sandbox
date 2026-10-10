# 普通轨道形状与当前非空 V4 存档 135

135 将 Classic 普通轨道从两个直线 variant 扩展为两个直线、四个 quarter 弯道和四个 ascending 方向的双向 edge。集成时两个原有正式 owner 回归失败均已修复：显式 placement rule 必须对所有 entry 选择同一 cell shape；新增合法配置的完整 definition identity 超过现有 checkpoint 4096 字符预算时，使用带 format discriminator 的无损 tuple 编码，旧预算以内配置保持原 identity 字节，最终仍超过预算则在装配拒绝。

本证据只证明配置、loaded-cell 部署投影和当前 straight-only 非空 V4 兼容。真实曲线/坡道驾驶、轨道实际 mesh、其余轨道/矿车/boat/fuel/container、更早非空 legacy 存档以及完整 Classic 主旅程仍未验收；不宣布运输完成或 PR 可合入，不包含性能收益声明。

## 身份与来源

- 修改前源：`356ec528a19d574867631a5e5851284e2a206be1`；base `fba4486e433c145db658f6b1598b70c47f759c8a`。2026-10-10 17:18 UTC fetch 后本地和远端 feature 均为该源，未覆盖他人变更。
- 当前非空 carrier 夹具由该旧源正式 `AuthorityRuntime` 部署、骑乘、输入推进和 checkpoint export 捕获，`captureKind=headless-exact-pre-extension-owner`。不是浏览器存档状态，也不是手写快照。
- production composition identity 来自既有成功 Browser128 `pr41-native-release-browser-128-01` 实际 native attachment；该浏览器源是 `5690ed3c6ddb5207e28dc8a7ae170ab7996230c8`，artifact digest `6df19efb5c70b9c688fc9bdd063b5acc19cbb776b8a8b6922b4dcec71b9418e8`，与修改前 356ec528 identified build 的产物字节相同。该身份来源不把 Browser128 宣称为 135 的产品验收。
- 原 capture 保留在私有 `/workspace/pr41-recovery-20261008-root-01/straight-v4-capture-135-01.json`：93665 bytes，SHA256 `17e88f4449f649b4c8b150bf2fe4ee44ba2216d6238367a9fed6362b3d3d5693`。新增 repository fixture 仅格式化，深层 JSON equality 通过，SHA256 `6bbb63737e03236d80b19dcec9c39c66c5fe67532f638393311d415db283f26a`。
- 新 predecessor 只接受精确旧 composition 的 gameplay V4；V1/V2/V3、不同 pack digest、definition 和 system identity 均拒绝。原 predecessor 和 sealed evidence 未改写。

## 修复和反例

1. Luna 的正式 Classic route consumer：缺少曲线/坡道配置时 13 FAIL / 13 PASS，添加配置后 26 PASS。原两个直线 ID 和双向 edge 保留。
2. Root 非空旧存档测试：没有精确 predecessor 时 2 FAIL / 1 PASS，加入窄 predecessor 后 3 PASS。保留 carrier pose、velocity、route cursor、rider、fuel、inventory、entity lifetime、玩家库存和 module schedule；只按原 restore 合同 rebasing epoch，旧 reference 无效。
3. 原矿车 Authority 测试因新增坡候选导致部署歧义失败；用泛型 resolver 反例证实已声明 quarter shape 时另一个唯一 straight entry 不得重选该 cell。原 resolver 1 FAIL / 14 PASS；修复后旧部署成功。未知邻居、无 rule 歧义保持拒绝，不改变 loaded/unknown 或碰撞语义。
4. 部署修复后原存档往返仍因 identity 超过 4096 失败；新 identity 反例 2 FAIL / 2 PASS，修复后 4 PASS。测试对较大合法配置独立还原所有 definition 字段，验证边顺序和 fuel capacity 变化导致 identity 变化，过大输入仍拒绝。没有抬高 checkpoint 限制。
5. 实际 loaded-cell 部署投影新增 12 例：10 种形状均选择一个一致 variant，长度分别为直线 1、quarter pi/4、坡 sqrt(2)；三方向连接仍 `transport-route-ambiguous`，不可用的可能高端邻居仍 `chunk-unavailable`。原配置 26 例加上投影 12 例共 38 PASS。

## 已运行与边界

- 定向 Web：实际执行 5 文件 / 56 PASS（配置、非空 save lineage、原 minecart Authority、motion frontier 和 death）。初次命令另含一个不存在的 `pre-transport-v4-checkpoint.test.ts` 路径；Vitest 没有执行它，不能计为第六文件。原早期 transport fixture 恢复用例位于已执行的 minecart Authority 文件。
- 定向 stdlib：6 文件 / 94 PASS（identity、route resolver、部署高度、route motion geometry、motion model、loaded geometry）。
- stdlib 生产、Classic Pack 生产、Classic tests、根 test types 均 PASS；定向 ESLint PASS；既有 CI selection 17 PASS；Prettier 和 `git diff --check` PASS。
- 原 Classic headless 和原 stdlib 全量 owner 回归结果在 `validation.json` 记录；未完成的项不得计 PASS。
- 当前证据运行绑定修改前源和本组受控候选 diff，冻结后的提交 SHA、identified build 与浏览器记录需另行绑定。135 尚未跑当前生产浏览器、当前 CI、实际 shape journey 或性能 A/A、A/B。
- CI417 对精确旧源 356ec528 的五个非浏览器检查 SUCCESS，Chromium 仍自然运行；它不能替代 135 的当前源验收，135 不抢推取消旧运行。

## 失败保留与预算

原 capture 第一次导入不存在的 host 路径，0 tests FAIL；更正为已有公开 host entry 后 capture 1 PASS，不删首个失败。集成时部署歧义和 identity-budget 两个原回归失败保留；以上不是重试盼绿。

全部原失败/GREEN 日志与 capture 代码保留在私有独立 run 路径，校验和见 validation。新测试只加入原 CI 选择清单，所有原用例、原 Browser 唯一入口、输入、900/240/90/20 秒时限和断言均保持。修改前 workflow 核实为 main push 才生产部署、同仓 PR 仅原 pr-41 preview，未增加权限或发布边界；无 main push、merge、automerge 或生产发布。

本组预注册 16:58 UTC，AI 25min x120%=30min，17:28 UTC 检查点。最新实际产品 UI 16:55 UTC 周剩余 74%、重置 4d10h（共享账号，非本 PR 独占）；保守剩余约 60% 停止线保持。没有以 tokens/credits/API 估算额度，也没有另启模型或测试探测额度。
