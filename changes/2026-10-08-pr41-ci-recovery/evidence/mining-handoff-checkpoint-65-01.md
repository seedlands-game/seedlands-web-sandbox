# Mining approach 安全距离交接 checkpoint65

## 行为与变更

Browser64第一次S100停稳后，player与Authority均在目标既有安全band，但旧mineVoxel继续追固定approach，第二次输入越过五单位guard。本片只在mineVoxel的walkTo参数中复用既有yieldAfterSettledPulse：原ACK推进、grounded/noncollision、Authority velocity0、presentation追上之后，两端目标中心距离均在原 `[2.5,4.5]` 才交接。随后原fresh snapshot、>5 guard、PointerLock、真实aim和采掘保留。通用walkTo语义、原100ms输入、15秒route配置、20秒settle/8秒action、整体900/240/90秒、quality/physics/renderer不变；不宣称性能收益。

新增mining-approach-handoff.test.ts并追加既有Classic headless selector；没有删除已有文件或弱化断言。夹具执行实际evaluate callback与真实mouse helper，只重放Browser64 readonly观察；aim用抛错marker确认交接，避免伪造挖掘或写owner，不是live Authority验收。

## RED/GREEN与验证

- 旧source有效RED：私有Task125 `task125-red-02.log`，1 FAIL，第二S后实际out-of-range而未到aim marker。
- `task125-red-01.log`漏PointerLock mouse baseline，是无效夹具尝试；原日志保留，不计行为RED。
- 候选四项GREEN实际EXIT0：first safe交接、server稍越安全下限不能早交接、fresh read漂移>5仍拒绝、PointerLock拒绝传播。Root更正原trace起点末位并加入global cleanup。
- Root九文件76/76回归实际EXIT0：mining、route-progress、equipment handoff/resource/aim、target aim、keyboard pulse、diagonal和single-click合同。私有日志 `mining-handoff-regression-65-01.log`。
- 完整verify:static:ci实际EXIT0：冻结5/5、格式/路径/lint、全types、Svelte0 errors/0 warnings、66项ESLint规则和15项CI合同。私有日志mining-handoff-static-65-01.log。
- 更新后的完整Classic headless实际EXIT0：106文件、673项PASS，164.58秒；私有日志mining-handoff-headless-65-01.log。
- 新精确HEAD identified build与唯一Browser65待验。产品/性能不从unit推导。

## 范围与预算

独立run预留 `pr41-classic-browser65-01`；不重跑Browser64，CI64已自然终态Chromium FAIL/部署SKIP，未取消；原两次C4返回900秒FAIL与Visual PASS已单独记录。模型服务metadata未核实；请求按Sol/high/default和既有Luna/medium。最后实际UI读数20:26UTC剩83%，停止线约60%，无token/credit百分比换算。传统0.2PD×120%=0.24PD，AI35min×120%=42min，21:00起有界checkpoint21:42。

长期docs baseline不更新：局部Harness消费修复，既有owner、输入和验收合同未改变。PR仍未可合入；lighting、正式transport全链、非空旧V4迁移、Modular、194、组合整帧性能及精确最终SHA CI仍需完成。
