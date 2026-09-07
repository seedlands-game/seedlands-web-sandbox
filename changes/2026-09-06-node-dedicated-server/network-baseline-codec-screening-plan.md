# N2 Node 22 基线编解码筛选程序准备

状态：以下保留执行前的计划。独立复审和真实尝试现已完成，最新结果见 [筛选进度](network-baseline-codec-screening-progress.md)：v1 环境未验证，v2 在预检时被拦截，没有可采用的性能组或采用决定。

## 输入、边界与绑定

隔离 runner 位于 `/tmp/seedlands-network-probe-codec-baseline-screening-v1`，只复制冻结 v2 codec 闭包，不修改 v1/v2、语料、生产 `src` 或包配置。每次运行直接读取并哈希派生 r2 manifest/frames（`9d590ded…85dfb`、`4320c31f…766d`）及绑定 raw r2 manifest/frames（`0d2959e7…0ad`、`2d3a0a9f…3b91`），而非相信 manifest 自报。无计时读取已确认 333 条，即 3 个 descriptor、330 个 page。

`encodeTotal` 热区仅为 `pipeline.encode(record)`；`decodeOwnedTotal` 仅为 `parse → validate → own`。强等价、哈希链、读页、输出及 sink 全在停表后；oracle 使用 `isDeepStrictEqual`，保留 `-0`。输出单列 descriptor/page 编码字节，不作频率权重或性能指标。

运行前后均重新核对输入 pin、本地 runner/codec 闭包、实际解析依赖、Node/V8/platform/arch。依赖锁 `pnpm-lock.yaml` 与 `.pnpm/lock.yaml` 的 SHA-256 都是 `2d107a0f…401b`；解析树登记 `protobufjs@8.8.0`（68 文件）和 `long@5.3.2`（4 文件）。任一漂移保持原始结果并禁止排名。

## 调度、留痕与排他

正式配置固定每候选 5 个同 iterations 的 warmup、5 对 A/A（30 条）与 30 条 screening，候选顺序轮转。每条 raw batch 记录 `iterations`、计划消息数与 encode/decode 实际完成数；计时结束后立即追加唯一 `wx` JSONL journal，异常、累计不足、绑定漂移或截止均先留痕，结果为 `FAILED_RETAINED`。100ms 是每候选每阶段的累计门槛，非单 batch 门槛。

runner 在 batch 边界做协作式 wall-time 检查；不能中断同线程同步调用。root 提供的 75 秒进程组 supervisor 是独立硬监督证据。runner 不创建、删除或抢占 reservation；只读 `owner.json`、外层环境预检文件及 hash，记录实际 owner/token/PID，并在结束时复核同一 reservation。校准与筛选可使用各自合法窗口，不要求复用 token。配置或门禁无效时，CLI 先写 `BLOCKED`，不加载 333 条输入。

## 校准与证据

`--calibrate <authorized-config.json> <journal.jsonl> <frozen-config.json>` 只接受 `CALIBRATION_AUTHORIZED`。它按预登记的初始 iterations、倍增、上限、校准 batch 数和累计目标，对所有候选使用同一 iterations；所有阶段达标且结束绑定一致时，才以 `wx` 写 `FROZEN_CALIBRATED`。未达上限目标写 `CALIBRATION_TARGET_NOT_REACHED`。

筛选配置引用的校准文件会被解析并核对 `CALIBRATED`、selectedIterations、绑定、依赖、reservation 快照与共同日程，不接受仅 hash 正确的任意文件。真实调用仅在 root 的独占窗口、现有 reservation wrapper 与外层 supervisor 下进行；计划编写时尚未运行 `--calibrate` 或 `--measure`，实际尝试另记进度。

## 无计时证据与剩余门禁

Node22 假时钟自检通过：15 warmup、120 A/A+screening 原始 batch、批内 encode 失败的实际完成计数、终态 journal、校准生成冻结配置、运行后依赖漂移转 `FAILED_RETAINED`，以及多原因 `BLOCKED`。实际 pinned 输入读取也通过。它们均不是性能样本。

执行前门禁为独立复审、root 的环境/owner 证据与真实校准；实际尝试及尚未通过的环境门详见进度。浏览器、完整 N2、网络、UI、WAN 与正式 wire 采用不在此范围。
