当前首个 A/A 在旧 NPC 场景初始化失败；正在等待新场景合同选择。该失败已保留，禁止当作有效噪声样本。阈值及最终执行矩阵以 ../spec.md 为准。

# 复现实验

这些脚本复用唯一 Classic 生产旅程，不新增浏览器用例。需要仓库锁定的 pnpm、Node 22.12+ 和 Playwright 配置选择的 Chrome。运行时/浏览器版本改变需重做 A/A。

1. 从 spec 的 control SHA 建立独立工作树，各自按锁文件安装依赖。对所有变体应用同一份 `diagnostic.patch`。单项变体只应用对应生产 diff；组合包含所有分项通过项。构建前冻结源文件，使用 `SEEDLANDS_DIAGNOSTIC_SOURCEMAP=1 node scripts/benchmark-window.mjs -- pnpm build`。
2. 为准备和采样共用默认全机锁，禁止设置独立的 `--lock-dir`。端口 4273、9487 必须可用；不要终止其他任务的进程。重型构建/测试也走此 wrapper。
3. 在任意位置执行 `node <本目录>/run-one.mjs <变体工作树绝对路径> <run-id> <独立输出目录>`。输出目录必须是本次新目录；run-id 不得重复。结果分析也单独取得同一把锁，使用独立 analysis 回执，不覆盖 benchmark 回执。脚本在锁内启动浏览器、连接其本地 CDP，CPU 采样 2000us、heap 采样 65536 bytes；不会对别的浏览器附加 profiler。
4. 暂停前的 `aa1` 保留为合同失败样本，恢复后的正式顺序为 `hotpath-r2v2-aa4/aa5/aa6`，随后每个候选 `hotpath-r2v2-m-a1/m-b1/m-b2/m-a2`、`hotpath-r2v2-p-a1/p-b1/p-b2/p-a2、hotpath-r2v2-c-a1/c-b1/c-b2/c-a2`；通过项的组合使用 `combined`。A 格传 control 路径，B 格传相应变体。每格完整退出、释放窗口后才进入下一格。
5. `node <本目录>/summarize.mjs <输出目录>` 验证窗口与测量摘要并提取指标；`node <本目录>/decide.mjs <输出目录>` 计算预注册噪声/否决/采用判定。任何缺失、失败或不同身份样本保留，不选好结果重跑。

原始数据包含每目标每段 cpuprofile、累计 heapprofile、事件时间线、源码映射、Classic/window 回执和退出码。函数 inclusive 统计互相重叠，不可累加。heap 是包含已回收对象的统计分配量，不是 live heap/RSS。主指标为 V8 采样活动时间（排除 idle/program、包括 GC），不是操作系统精确线程 CPU；受固定观测器影响的本机结果不能外推真实设备帧率。浏览器关闭后的尾段捕获失败明确记录，不伪造尾样本；主指标仅使用 C1 完成后至 C4 完成前的完整片段。
