# 原生诊断窗口边界147

146实际20秒窗口data loss。只把opt-in native trace窗口缩到5000ms，保持延后360000ms、16MiB buffer/64MiB stream、原类别及丢失即失败。没有玩法输入/超时/质量/CI选择改动。

既有unit在5000ms要求Tracing.end，旧实现1FAIL/10PASS；新实现五文件35PASS，Classic types和两TS ESLint通过。完整原始日志及hash见validation。新identified artifact的唯一浏览器采集仍待运行，不能从mock CDP通过宣称Chromium无丢失、产品通过或性能收益。
