# V2 Canonical Discovery Boundary Close-17

本目录封存 Playwright 1.62.1 的真实纯 discovery RED/GREEN、现有 canonical selection 的读回、Classic/root types、
配置 ESLint、正常 Prettier、scope 和最终自检。原始命令 stdout/stderr 使用 `.json.log`/`.log` 保存，不作为可格式化
metadata 改写。

RED exit 1，精确重现两份历史 evidence snapshot 的缺失 `visual-rebuild` 导入；GREEN exit 0，只发现真实 canonical
spec 中的 main、visual、modular 三条 identity。`--list` 没有运行测试、webServer 或 Chromium，因此本目录不声称
Browser25 或产品 GREEN。
