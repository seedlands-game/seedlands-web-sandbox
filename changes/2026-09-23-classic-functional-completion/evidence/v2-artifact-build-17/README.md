# V2 Artifact BUILD17

状态：`PASS`。本阶段从已推送 source
`4052dae01d4527bd1747a60358cf59469ab1b3e2` / tree
`12ed2ba3e8be11ccf5ba79aba684b03ca7c82cd5` 构建新的 production artifact。GIT42 最终 delivery 文件的
SHA-256 为 `b74599e40309a5a75fe91232ea15f3927e5270dff9b5b7ba4eaf41a11f353929`；本目录不改写 GIT42 原件。

acceptance tree 固定为 `/private/tmp/seedlands-v2-acceptance-4052dae0`。它从保留的 clean BUILD16 tree 通过
APFS copy-on-write 创建，再只应用 BUILD16 source 到 GIT42 source 的 tracked delta；构建前必须证明 tracked/index clean、
`apps/web/dist` 不存在、内部 workspace links 均解析到本树。首次直接 checkout 因历史大 trace 展开耗尽磁盘而在 49%
停止，未执行依赖安装、build 或 artifact verify；失败的 task-owned partial tree 已删除。

离线 frozen 安装下载 0；根、Web 与 Classic 的内部 workspace links 全部解析到 acceptance tree 自身。默认机器锁内
唯一 build runId `v2-artifact-build-17-build` 与唯一 verifier runId
`v2-artifact-build-17-artifact-verify` 均 `PASS/exit 0`。两次输出 identity 一致：

```text
sourceDigest=21c84cd108b96deb6187a474bddf9779e027d2095be82a404b27c4815d321671
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=da1c156aaf1c4e3b40a12087301466e2b14291a49f4b5d5a1dfed66afe5c032f
files=276
builtAt=2026-09-29T05:20:40.897Z
```

receipt SHA-256 为 `f00fe6ff759dfa8d5f73bea92d83c25ddd0495b67d2e6cd355ed0201ee2f4043`。receipt 与独立
磁盘 map 都有 276 项，map SHA-256 均为
`766478f46bb2b048317e149a595c5a704c26788dc8a28a49ee43b4a33effccde`；磁盘含 receipt 共 277 个普通文件，
0 symlink/missing/extra/mismatch。相对 BUILD16 的 map 有 10 个路径变化：旧/新 authority、bootstrap、
chunk-persistence、game chunk 共 8 项，加 `.vite/manifest.json` 与 `index.html`；完整旧/新 hash 见 diff。四个
stdlib Harness 生产源的旧/新 bytes 与 SHA-256 见 inspection，没有把产物变化误记为 Browser 通过。

Pack lock public/dist 均为 `f362a074758f751d828d3881d9427a0945ae5efbce3237dfd3e287d24676c16f`。MP3
source/public/dist 均为 2,976,045 bytes、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`；Pack lock 中该路径恰好一项，
`contentType=audio/mpeg` 且 size/hash 匹配。

本阶段不运行 Browser26、Cua、dev server、CI、deploy 或 merge。Browser25 只证明旧 source；新 reference 的 old
stale/new current/UI continuation 仍为 `NOT_RUN`，artifact PASS 不等于 Browser 验收或产品 GREEN。
