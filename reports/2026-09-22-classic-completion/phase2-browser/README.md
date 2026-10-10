# Phase 2 v11 浏览器证据

本目录记录 Classic worldgen v11 的真实浏览器画面。开发态检查使用隔离的 `agent-browser 0.33.2` 会话；正式生产构建身份与 exact-head 读回在阶段交付快照中登记。

验收范围：

- 推荐 Seed `mosslight-68` 以 `new-current` 创建 v11 世界；
- 首帧可见连续地面、天空、抬高树冠和至少一条短距离通路；
- Pointer Lock 获取成功，并以真实 W 输入和鼠标移动取得第二帧；
- F3 世界诊断显示 `Generator v11`；Wasm 诊断显示 `simd · matched`、0 trap；
- 页面错误和失败网络响应在正式构建复验时登记。

开发态截图：`dev-v11-first-frame.png`、`dev-v11-after-move.png`。它们不替代生产 artifact identity 或 C0–C5 canonical 证据。
