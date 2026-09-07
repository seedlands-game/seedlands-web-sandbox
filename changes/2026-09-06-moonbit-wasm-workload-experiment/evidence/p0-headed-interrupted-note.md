# 中断的 headed P0 证据说明

- 状态：`excluded_by_user_headless_requirement`。
- 用户在运行中要求后续浏览器测试全部改为 headless。旧运行随即以 `exit 130` 中止，其独立临时 Chrome 已关闭。
- 已写出的 headed 长窗口与早期设施校验数据都不与正式 headless 基线混合，也不留在提交目录。
- 可恢复临时归档：`/tmp/seedlands-p0-headed-interrupted-20260906.tar.gz`。
- 归档 SHA-256：`123080e2b39e2516ac7cd25913d1fdf3c7761f139608fdeac61338cb2f00aec9`。
- `/tmp` 归档不属于长期交付物，可能随系统临时目录清理而消失；正式证据只认同级 `p0-aa-summary.json` 与 `p0-profile-*.json`/`.json.gz`。
