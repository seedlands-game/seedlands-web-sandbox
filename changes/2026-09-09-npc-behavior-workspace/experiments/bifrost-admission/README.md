# Bifrost 网关准入实验

该实验仅使用本地受控 mock provider，固定 Bifrost HTTP Transport `v2.1.0` 镜像摘要。它验证共享 provider 并发池、32 个等待位、重试、截止时间、取消、工具历史、opaque 字段和同层模型替换。

```sh
./run.sh
```

默认使用 `127.0.0.1:53767` 和 `127.0.0.1:53768`，可用 `MOCK_PORT`、`GATEWAY_PORT` 和 `RUN_DIR` 覆盖。运行前应确认端口空闲；脚本只创建并清理带当前 PID 的任务容器。所有 key 均为无效 mock 值，不读取项目 `.env`。

固定候选和配置见 `manifest.json`、`config.json`。当前结果为 **NO-GO**：实际 429 返回 `Retry-After: 1` 后约 100ms 即重试；两个各 1 秒的 429 之后仍发起第三次调用，说明配置的 2 秒 provider timeout 不是包含重试等待的总截止；客户端取消后，下游请求直到 provider 的 2 秒截止才关闭；OpenAI 兼容入口即使开启 raw response 与 extra-param passthrough，也没有把消息内的必需 opaque 字段送回 provider。无需自定义中间件即可满足的其他门槛见 `results/summary.json`。
