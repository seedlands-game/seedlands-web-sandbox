# 桌面世界不创建未使用的XR管理器

## 背景与目标

60分钟长测的逐会话GC计数显示每次重建增加一个监听器。20次独立GUI进入/退出复现：第三次到第二十次增加17个，窗口、document和游戏Canvas监听器却保持不变。核对PlayCanvas2.21.4源码，XrManager构造时在navigator.xr上增加匿名devicechange回调，destroy没有移除，会保留已销毁应用。

## 范围与明确不做

本次桌面MVP明确不含VR/AR。通过Application公开init扩展点，让AppOptions的可选xr保持运行时默认null，不创建无用XR管理器。保持同一Application、渲染/输入/材质/后处理/音频与世界；不篡改navigator、全局事件方法或第三方包，也不移除其他对象的监听器。

## 决策

沿用PlayCanvas AppBase已支持的可选XR配置；局部桌面Application子类只在init时清空该选项。AppOptions实现默认xr=null而类型声明遗漏nullable，以Object.assign设置公开配置并注释来源，不使用私有XR字段或全局猴子补丁。

## 行为

Given 支持navigator.xr的Chrome，When 重复创建并销毁桌面世界，Then 不新增XR devicechange订阅；GC后全局/文档/Canvas/总监听器与DOM数量回到稳定区间。Given 普通游戏，Then 原有相机、键鼠、光影和存档继续工作。

## 测试设计

父 `e2e/listener-recovery.spec.ts` 已取得20次会话有效RED：总监听器增加17，容差3。补采navigator.xr的确切事件来源，再修复并用同样20次GUI循环GREEN；额外检查真实游戏/高级光影与静态/Build。不以提高泄漏容差通过测试。

## 验收与证据

- [x] Playwright-change：20次退出后总监听器有界，XR事件不逐次增长，DOM和Worker回收。
- [x] Playwright-change：游戏外壳与高级光影仍工作。
- [x] Static / Build：完整静态与生产构建。
- N/A：无视觉美术或音色变更，不重做审美验收。

## 任务与当前状态

Delivered：桌面Application不创建未使用XR管理器。

## 交付快照

固定48d2dd2长测包含此每会话泄漏，不能将其单独称为无泄漏通过。后续以该长测的连续运行/真实死亡结果，加本修复更密集的20次生命周期回归分别取证，明确source边界。

最终RED：20次退出XR监听器1→20、总57→76，DOM1268不变。GREEN：20次退出XR始终0、总56、DOM1268；单项23.9秒通过，最终与Shell4项/高级光影3项组合8项52.5秒通过。父 `listener-recovery.json` 保存逐次RED/GREEN计数。完整Static234 passed/4 skipped、world95.03%、Svelte0/0及Build通过；最后测试调整另经格式/ESLint/typecheck。生产仅修改scene-bootstrap公开初始化配置。
