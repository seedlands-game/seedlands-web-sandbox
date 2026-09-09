# 模型网关生产化证据

生产源码位于 `scripts/model-gateway`，本目录只保存 deterministic focused tests、完整 mock G、固定 manifest 和原始结果。

Focused 边界回归：

```sh
changes/2026-09-09-npc-behavior-workspace/experiments/gateway-production/run-focused.sh
```

完整 mock G：

```sh
OUTPUT_DIR=/tmp/npc-gateway-production-run \
  changes/2026-09-09-npc-behavior-workspace/experiments/gateway-production/run-full-g.sh
```

两者都从生产 `Dockerfile` 构建同一个固定 tag。完整 G 只把 flash/pro deadline 临时降低为 5 秒来形成确定性故障证据；镜像生产默认仍为 flash 60 秒、pro 300 秒。

生产启动入口的 mock-only smoke：

```sh
OUTPUT_DIR=/tmp/npc-gateway-production-startup \
  changes/2026-09-09-npc-behavior-workspace/experiments/gateway-production/run-startup-smoke.sh
```

该脚本用 `env -i`、假 key 和受控 provider 调用正式 `scripts/model-gateway/start.sh`，验证显式模型映射、loopback 监听与配置加载；不读取开发机已有 provider 环境。
