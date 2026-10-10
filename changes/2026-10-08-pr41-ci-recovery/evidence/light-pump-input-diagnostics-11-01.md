# 光照队列与失败输入诊断 checkpoint

状态：定向合同闭包中，新的 artifact/browser 尚未运行；不据此宣布产品可合入。

## 已证实与修复

实际 `World.drainCommits` 仅由 render 调用一次时，原实现只重建一个真实 light brick，剩余 dirty 在 render 停止期间不被服务。独立 `BlockLightRebuildPump` 每个 timer turn 至多服务一次，最新摄像机位置复制，重复请求不产生并发 timer，完整 build/apply 后让出至少 16ms 或上次耗时四倍；dispose 先取消 timer。保留原 flood、R8、未知阻光、GPU sink 及 mesh drain 语义。假时钟证明功能调度，不证明性能改善。

真实 cache 初次构建后，仅修改 reader 的 halo 身份、没有 invalidate/register，原 snapshot 仍报告 pending0/readytrue；这是独立 RED。snapshot 与 failure diagnostics 现在只读比较当前身份，rebuildNearest 才把新失效项入队；已有 dirty 首次等待计数不重置。复查旧远近 brick 测试发现其 reader 全局 revision 同时改变两个 halo，却期望仅近处失效；改为只返回近处的新身份，原 pending1 与距离/释放断言完整保留。

已接受的 input-decision receipt 在原 client sequence/epoch 门禁之后计数，使用 WeakMap 隔离生命周期；读出冻结副本、回调副本和重入门禁保持。失败 attachment/job log 记录有界 receipt 分类与 startup DOM alert/card/button，只读诊断，不改变输入调度、owner 接受逻辑或成功断言。原启动10秒与visual20秒等待不变。

## 验证边界

完整Classic headless新入口30文件149/149 PASS（68.14秒）；原27文件合同保持，新增pump/client诊断覆盖使用同一入口。它是持续回归证据，不替代真实键鼠/WebGL产品验收。

独占 pump fixture 的有效 RED 为 `block-light-pump-red-03.log`（前两次 fixture/import 错误不算行为 RED）；身份反例为 `block-light-pump-red-05.log`。当前 pump 8/8 GREEN，四文件组合34/34 PASS，完整Classic types与cache源码/fixture scoped lint PASS。组合首轮1 FAIL/12 PASS是上述近/远reader身份fixture失真，修正后原断言通过。先前只读 receipt3/3、生产 Web types 零错误/警告与13路径 scoped lint 已 PASS；所有失败与最终输出分别保留，不覆盖重写。

CI source e3b8f938 的 run37807543513 已终态：architecture、deterministic、Classic headless、build、Static verification PASS；Chromium两失败一跳过，预览未发布。sparse fetch约一秒关闭此前 checkout 超时；主旅程启动与visual ready原因尚未由新diagnostics确认。原 Browser10 产品失败仍未关闭。后续新唯一artifact先跑原 Classic spec 的 visual correctness subset；这不覆盖 C0-C5、性能、完整PR审查或原需求缺口。

最新主对话实际周额度读数为16:33UTC剩余93%；本云无法读取真实UI，以该读数为依据，约60%停止线保持。
