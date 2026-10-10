# Sky 暂时失效恢复125

2026-10-10，基线308d2cc58e3c7c2059abedad24f04f6861be8b58。独立功能修复，不是冷启动超时或C4原因结论。

## 行为与边界

实际 `WorldSkyLighting` 在列目录或非驻留屋顶读取明确失效后，把同一版本的列标记为已处理，缺少下一次重建。旧入口行为RED：2 FAIL/20 PASS，两次均只有一次请求，原16ms调度没有恢复。

Sky专用响应现在保留 `superseded` 原因。客户端仅在当前runtime epoch与准确key时将其转换为本地类型错误；WorldSky将该列重新排队，仍用原16ms、至多一个pending调度。Worker的首个及最终短Host frontier区分保存fence变化与缺失/损坏数据，IO继续在writer队列之外。普通缺失、损坏、预算超限或已释放来源保持暗且不轮询；碰撞baseline可用性、严格revision/shape、借用buffer与所有存储/复制/缓存预算保持原合同。

## 验证

- 相关5files 62 PASS：目录及真实Sky解码器的非驻留屋顶恢复、保存前后frontier、单任务与释放/epoch反例、严格存档数据及队列外IO。
- 测试夹具坐标端口类型修正后，最终WorldSky 27 PASS；生产Web/Svelte 0error/0warning与tsc/tools、Classic类型、范围lint PASS。第一次Classic类型FAIL日志保留。
- 三个修改的测试文件均在原headless和Classic类型名单，未改CI收集或重试/等待时限。
- 当前冷Browser仍沿121记录为整体FAIL，cold-source/ready NOT_RUN；未重复浏览器、未运行本片build或性能采样。源码行为与真实冷WebGL2验收分别记录。

原始日志在Cloud私有恢复目录，文件摘要见 `validation.json`。原CI415绑定308d2cc5自然运行，本片提交不取消或冒充该SHA结果。预算最新实际UI为14:25UTC剩75%，约60%全PR停止线保持，刷新待主对话；费用/额度占比未知，不换算。

长期代码地图更新暂时失效传递及失败语义；架构与安全基线未改变。原交付ledger117仍未闭合，PR不可合入。
