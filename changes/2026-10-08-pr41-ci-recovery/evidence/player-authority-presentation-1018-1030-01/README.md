# Authority 到客户端相机的同步验收

本组在父提交 `30b3f2a7fd08062a0be4f196755472c802c8bcd0` 的九个冻结源码路径上验证；不是最终精确提交 CI 或性能证据。

真实预测器接收 Authority 快照后立即通过既有 collision-safe presentation 更新非 spectator 相机，使用零 elapsed，不推进物理或插值时间。提取 collision world 适配器仅为遵守现有文件行数门禁。保留真实键盘、输入中和、epoch/tick/ACK、碰撞、路线目标、质量、trace 和原截止。

1017 包含一个语义失败和一个 Float32 夹具精度失败；1018 修正夹具后仍保留唯一语义 RED。1019 相关六文件 52 项通过。1020 类型通过但 lint 因 controller 超 500 行失败，计划中的 1022 headless 未运行；提取原样适配器后 1023 静态与 17 项选择通过。1025 完整 165 文件、1292 项 headless 通过；1027 探针 lint/格式和 1028 构建通过。1029 原生 W/S/Space 路线通过，不能替代完整主旅程。

1009 原900秒主旅程失败，C0–C3通过，C4 outbound 被总截止中断，C4/C5无PASS。两次木锄点击通过，但不证明旧899点击问题已修复。旧探针按 textContent 查找 aria-label 名称，其 button:null 无效；撤回原生 dialog 归因。1030 修正只读探针，在同一原900秒主旅程零重试运行；终态 exitCode=1，具体断言和阶段以 results-summary 及原始附件为准，不能从退出码推断全部产品需求已满足。

1030 原始阶段附件仅确认 C0–C3 PASS。C4 outbound 在48.145秒/53次脉冲后被原900秒总截止中断，C4/C5无PASS；相机同步修复没有解决完整主旅程问题。两次木锄点击 PASS；更正后的只读探针实际读到按钮 connected=true、disabled=false、display=grid、visibility=visible，不能据此断言旧899点击问题已经解决。

1029/1030 私有运行器说明字段误继承旧船模板。原 prereg 保留，correction 文件撤回错误说明；实际进程参数分别选择原生键盘与主旅程，原源码截止分别120秒与900秒。不得把这些运行称作船验收。

完整货物/燃料交互、旧 portable-world 导入、船的浏览器存档重开、灯光真实浏览器矩阵及最终精确 SHA Chromium CI 仍开放。本组无性能提升结论。原始 .log 字节保持不变；结构化输出与此说明先格式化，再封存 manifest。
