# 当前交付快照

2026-09-22。状态：用户要求停止继续修复与试玩，先提交并推送当前阶段。本 change 仍 Active，不宣称整体视觉重构完成。

源码身份：分支 `feat/classic-beta173-playable`，本轮基底 `6b82a5d264d148acd1eaafabc5a15663c3cb1d8b`；本文件随本轮阶段提交归档，实际提交及远端 SHA 以 Git/PR 读回为准。

## 已实现

- 八种内置植物重绘可辨轮廓；普通蘑菇恢复棕色，红蘑菇保留分散白斑，去除周期斜纹；草地、高草调色收敛；后处理取消额外增加饱和度。保留用户外观覆盖、生成版本与真实植物数量。
- 快捷栏、背包槽、创造目录共用槽位 token；移除生效样式的重复边框和厚重 PNG 框，九格宽度按实际列数计算；目录固定滚动视口，移除常显内部 ID。
- 基础配方展示排序、彩羊毛/染料统一颜色名称源、统一工具尺寸与锚点；战斗 ready 仅保留无障碍状态，动作反馈保留。
- 体验场改用当前 zombie；普通启动、后置体验场布置及 runtime fatal 的失败路径清空呈现状态、隐藏旧画布，重试恢复画布；推荐 seed 精确提示继续所选版本或新建另一版本；现行帮助同步退役物种。

## 已验证

由 Terra 执行，重型检查均经默认 benchmark-window 锁：入口 22 项、UI/名称/展示 17 项、植物资产 4 项窄测试通过。这些是分包测试结果，不代表完整产品行为测试。最终合并工作树 Web typecheck 与 Svelte 检查 0 errors / 0 warnings；SSG 检查、目标 ESLint、Prettier、diff 检查通过。未执行 E2E、Playwright 试玩或性能采样。

执行记录：本地 `/tmp/seedlands-jev-play-20260922/entry-package-checks.md`；前态图片、录像与审看页保存在同目录。先前并行阶段 typecheck 有过 recipe ID 类型错误，已修复后在最终工作树通过；一次使用错误 Vitest config 导致 No test files，之后使用正确配置通过，不隐去失败。

## 未验证与后续

继续阶段新增：门框/把手、梯档与透明间隙、火炬木柄/火头及栅栏木纹；Ladder cutout 同步 Web 材质与 stdlib 分类。窄结构/材质测试 24+1 项通过，stdlib/Web 类型检查通过。根据 run25 实机再次修正花心黄条、草叶直杆和蘑菇帽尖底；最后草顶改低频簇并缩窄色阶，相关 4 项测试和 Web 类型检查通过。没有改变世界生成或栅栏碰撞。

实际复验状态：锁屏解除后取得 `run25-resume-forest/final.png` 和可解码的 6.912 秒录像，主线程确认第一轮植物颜色/HUD改善，也据此发起上述返修。最终植物/草地返修尚未再次实机验收。随后 Cua native 遇 ScreenCaptureKit/AX 失败；typed browser 可 exact bind 和读取，但部分 trusted-input 因 off-Space 被拒绝，未将拒绝当产品失败或操作成功。用户停止时未完成背包、目录、采集/放置、体验场完整路径。

默认静态 PNG 缩略图尚未从最终材质重新派生，目录图可能仍显示前一版；这是明确待办，不应仅凭源码材质已改宣称全部显示面一致。无 E2E/Playwright 补跑，无新的完整生产构建结论。

Cua 新录制受 macOS 锁屏阻塞。主线程直接查看 `run20-mission-control.png`，确认需要 Touch ID/密码；无认证尝试，录制已 disabled，不持续重试。`run19`/`run20` 不是修复后游戏证据。解锁后由 Jev/Cua 执行 [组合体验矩阵](visual-acceptance.md)，主线程审看，重点包括森林、目录搜索、九格 HUD、工具与体验场恢复。

门/梯/火炬/栅栏结构纹理源码已修，派生 PNG 与实机效果仍待办；栅栏横档、地形树冠层次、生成密度、出生通路、生物动作与夜间照明仍需后续完整验证。已否定“修改前门/火炬 PNG 一定过期”的推断；它们与修改前源码薄板/细柱几何相符，缺结构纹理才是根因入口。

## 边界与预算

长期基线 `docs/classic-visual-style.md` 已补植物身份、后处理饱和度和目录信息规则，因为这些是跨工作包长期约束；局部实现不抄入长期文档。无关 `changes/2026-09-22-hotpath-allocation-baseline/` 保留未动。未重启或停止用户 Vite，未修改旧世界存档、凭据或权限。无 Blender 操作。

传统 PD、agent 工时为 spec 中规划估计，实际模型 credits、token、API 等价费用及额度分母没有可靠统计，记 unknown；未把工具等待或分包耗时当作计费实耗。首次实现及结构纹理源已实施；生成层调整未实施，进入下一阶段前按确切范围重估。未创建 Goal。

停止收尾读回：Cua recording/video_active 均 false，无存活 runner 或 benchmark 命令；保留任务隔离 Chrome，未终止共享 Cua daemon、用户 Vite 或旧 Chrome。用户此次授权为阶段 push，不代表剩余视觉待办验收通过。
