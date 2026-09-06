# 已确认MVP功能的包体成本基线

## 背景与目标

本次加入Svelte生存界面、原创2,119,538字节面板、Tone音乐和Change9规则后，旧2026-09-04原型的包体不再代表相同功能集合。最终Harness已经完成正确性、浏览器与Node汇总，只有三个包体指标相对旧功能基线超过15%，导致总命令非零。当前构建总量4,691,682字节、全部JS2,476,700字节、全部JS gzip661,523字节；这是真实新增下载成本，不是运行时性能优化收益。

## 范围与明确不做

为用户已授权的MVP功能建立三个包体指标的新功能基线，并在同文件保留旧值、功能说明、源码与change出处。只更新totalBuildBytes、jsBundleBytes、gzipJsBundleBytes，不更新世界生成/网格/存档/堆内存的旧运行基线，不改变5%警示、15%回归判断或父合同帧时间/输入门槛。

不删除音乐、降低美术准出、不将新增功能体积称为优化，不以调整包体基线掩盖运行时退化。不实施另一个按需分包重构；649.22kB入口gzip与独立缓存面板属于本次MVP接受的成本，后续优化须有独立前后对照。

## 决策

父Goal明确授权自主确定本地实现与验收边界；本次是新增功能后的成本基线，不是同功能优化实验。保存旧值和当前增量，未来同功能迭代继续受原相对门槛约束。原`createdAt/environment`继续描述核心性能基线，新`bundleBaseline`单独描述此次包体更新来源。

## 行为

Given 同一MVP构建，When Harness比较包体，Then 与新功能基线比较；原型到MVP的+129.9%总量、+26.0%JS、+29.8%gzip增量仍可审计。Given 任一非包体指标，Then 比较基线与本次前完全相同。

## 测试设计

有效RED为关联run `7f6cfa7c-9908-497c-a5eb-e6f433ce2f01`：234单测、Build、9浏览器、worldMutation与actor预算全部通过，但三个包体项目REGRESSION。更新前后程序化检查其余指标逐项相等；随后在已提交源码上重跑关联Harness，记录真实run id和source。

## 验收与证据

- [x] Static：JSON/脚本格式、ESLint与路径检查通过。
- [x] 配置检查：只改变三个包体数值，其余原指标完整保留，旧包体值与来源留档。
- [x] Vitest / Build / Playwright-baseline / Harness：当前源码完整关联准出，运行时比较保持原门槛。
- N/A：本change不修改生产图像、音频、UI或规则，视觉语义仍使用父合同的独立证据。

## 任务与当前状态

Delivered：只更新三个包体基线，其余指标逐项保持原值。

## 交付快照

2026-09-05 最终执行 `SEEDLANDS_E2E_PORT=4250 pnpm harness` 成功，源码 `7a368506eccf9879e1c7a6681862bdb4b7acaba9`，关联run `8a254d1f-01bc-4757-a130-7539f4ae8e63`：234项Vitest通过、4项明确跳过、Build通过、9项浏览器基线21.3秒通过；Node worldMutation、浏览器回归与性能采样均PASS，比较无REGRESSION。父合同 `harness-final.json` 保存同次报告；脚本ESLint/Prettier/路径门禁通过。该证据不替代音频主观试听。
