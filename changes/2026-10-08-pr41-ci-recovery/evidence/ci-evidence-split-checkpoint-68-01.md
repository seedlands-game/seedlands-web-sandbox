# checkpoint68 完整浏览器证据分包

实际CI65 `classic-37992680474-1` artifact11647256747共570695923bytes，连接器明确报单包上限536870912bytes；原V2两次900秒FAIL与visual PASS日志可读，trace下载未成功。无审批拒绝、凭据读取、扩网络或旧证据改写。

同一精确pinned upload action保留全部原目录：`classic-<run>-<attempt>`继续含harness/results与test-results，`classic-report-<run>-<attempt>`含完整playwright-report。原always且runner非skipped条件与7天retention不变。主结果/trace无文件error，独立HTML缺目录warn，保持原聚合任一目录缺失仍可上传的语义。未裁剪trace/video/报告附件，不改变生产artifact、runner、原断言、时间、重试、flaky拒绝、job权限或生产/PR预览部署条件。

新增已有工程测试先在旧单包真实RED（1FAIL/1PASS），分包后完整16CI合同PASS，最终完整static EXIT0。合同验证三目录精确且唯一归属、HTML与raw trace分离、同失败保留条件、同pin/retention以及run/attempt名称。当前CI66使用旧布局且仍执行，不抢推取消；新包实际尺寸与可下载性须在下一精确SHA CI验证，不能预称512MiB问题完全关闭。

长期docs/ci-testing仅记录实际证据布局及待验限制，未更新产品/性能baseline。根有界复核上传与部署块未发现新的可证实P0/P1/P2，不等同完整PR可合入。预估0.12PD/18AI分钟，本片22:31–22:36约5分钟，与67共享预算，22:09真实剩83%，约60%停止。
