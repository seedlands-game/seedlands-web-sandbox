# 单次C4原生诊断293

源码b62409ce，独立run/source身份、source freeze、retries0，显式30m仅诊断。61条V2路线returned后C4去程原90s失败，92055ms/33pulses，最终Authority x135.9546；返程/C5未到达，后验产物核验通过。

原C4阶段5秒trace COMPLETE，无dataLoss，4.16MB/17617events。覆盖准备及首批真实键盘事件，含4keydown/2keyup，不能称纯移动性能窗口。Worker、GPU交换缓冲、DevTools主线程同时有较长墙钟事件，嵌套/等待/诊断负载不能当CPU利用率或收益；未确认GPU或具体函数根因。末段debt约3.65秒，失败后暂停读回约8.38秒，保留不同观察时机。

同SHA CI431五非Browser通过，Chromium失败：main首轮V1空间中心5秒predicate、重试V2全局900秒超时；visual一次通过，普通矿车首轮真实路线失败后重试通过为FLAKY，Modular/Pages跳过。当前正式main/C4/C5和完整产品验收仍开放。result.json保存精确状态和原始文件摘要；raw trace保留在私有独立run路径。
