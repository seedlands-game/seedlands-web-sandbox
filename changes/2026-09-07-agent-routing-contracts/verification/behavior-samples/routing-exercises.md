# 最小上下文路由行为演练

所有样例只按 `agent-work-routing` 的入口与对应单一参考判断；未创建 agent、未连接线上服务。

1. **“一百行已整理数据要写线上表并读回。”** 先选确定性 batch runtime，而非逐行工具调用。此演练生成并通过了本地准备合同；因为没有目标表、账号授权或 adapter，合同保持 `externalWrite=false`，外部写入须另有明确授权和适配器。
2. **“按已定规范重构服务端并验收。”** 这是明确开发，选 Sol/high 的有界 implementation 合同；先读规格、写 RED，再由 Terra/high 独立验收。不能交给 Luna/Spark。
3. **“从指定文档提取支持矩阵。”** 这是限定资料提取，选 Luna/medium extraction；合同只给文档读路径和矩阵输出，不能扩大为方案设计或外部写入。
4. **“只读检查旧 import。”** 先用确定性 `rg`/静态扫描；若必须委派，才是 Spark/xhigh 的 `text-scan`，保持只读，不创建独立任务。

这些是路由结果，不是对四项请求的实际执行。
