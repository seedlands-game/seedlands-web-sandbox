# Bifrost 最小兼容补丁审计

该目录固定检查 Bifrost HTTP Transport `v2.1.0` 的 released source。结论是在写补丁前即遇到合同级阻塞：fasthttp unary ingress 不提供普通客户端断连的 cancellation signal，无法用局部 retry/provider patch 满足 AbortSignal → downstream cancellation。

源码探针：

```sh
./run-source-probe.sh /tmp/bifrost-v2.1.0-source
```

探针只临时向给定 upstream source 复制一个测试文件并在退出时删除。没有兼容补丁或派生镜像，因为能解决入站取消的改动会越过合同限定的最小边界；`manifest.json` 明确记录 `BLOCKED_BEFORE_PATCH`，避免把未验收的局部改动误当成可用 artifact。
