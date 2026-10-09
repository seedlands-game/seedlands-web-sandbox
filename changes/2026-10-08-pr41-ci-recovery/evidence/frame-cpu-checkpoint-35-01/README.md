# checkpoint35：公开帧事件 CPU wall 诊断

Browser25（939e0165/build24）whole 1 FAIL、原 visual 1 PASS、Modular 条件1 SKIP。新负Z双田作物步骤与原V1通过，V2达到900秒整场期限，原trace/results独立保留于Root browser-25-results。未完成保存恢复、全194与组合整帧A/B。

新增客户端只读 observer 用实际 frameupdate/framerender、prerender/postrender 事件配对，容量128，snapshot独立冻结，reset/app destroy清理；不改变玩法、渲染器、质量或时限。update区间包括同步系统/app callbacks/input polling；render区间包括中心CPU/driver调用，排除resize/frameStart/frameEnd，不是GPU或cull时间。初始化或缺配对不生成零值样本。

Task65缺失API有效RED及4/4 GREEN已保留于fixtures输出；第一轮生产types PASS，scoped lint因Game501行FAIL，已改为复用frameLoop窄readonly binding并继续原500行门禁。必要静态与浏览器结果以完成回执为准，不提前宣称PASS。无性能改善声明，后续完整旅程只用于诊断。

本组实际静态终态PASS：`frame-cpu-full-static-35-01.log` exit0，冻结5/5、格式/路径/lint/全类型、Svelte0/0、规则66、CI选择器14；`frame-cpu-headless-35-01.log`77文件526/526、137.97秒。旧失败日志保留。新的build/browser尚未运行，这些确定性结果不证明V2全程、保存恢复或性能收益。
