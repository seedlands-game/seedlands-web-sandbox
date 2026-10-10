# 截图观察轴无预注册收益 checkpoint86-02

精确source2b17241b/artifactefd549f3，同一暂停静止的真实WebGL2生产场景，真实window/run `pr41-observer-warm-aa-ab-86-02`。首次A/A失败原样保留，本轮唯一控制修正为完整截图取帧路径90秒预热，保存warm trace；原15%噪声线、每段30秒、段间5秒、viewport/quality/pose/revision/geometry/queues/驻留与其他trace字段保持。12个样本的固定场景字段均PASS。

A/A组中位462.50/516.60ms，噪声11.051%≤15%，条件AB执行原2AB+2BA。A(screenshots=true)组median345.85ms；B(false)370.775ms，改善-7.207%，没有达到原≥20%线。组p95为924.9/908.3ms（-1.795%尾部变化）。结论`NO_PREDECLARED_BENEFIT`，不是截图关闭优化通过；窗口PASS/measurement RECORDED仅证明受控命令完成。各段仍有显著顺序差异，不能挑最后一对、拼首轮样本或宣称严格GPU因果。

raw JSON、所有四AA/八AB traces、warm trace、脚本/日志和窗口收据保留私有`/workspace/pr41-recovery-20261008-root-01/observer-*-86-02.*`，validation绑定原始摘要。旧86-01 UUID与AA18.20%失败记录不覆盖。此场景没有持续Authority消息/移动/装备/主旅程，不证明C0–C5或组合性能。

关闭该观察候选，保持正式Playwright/CI trace、截图、质量与时限；不做第三次控制运行。82生成候选仍未正式采用/推送；整PR的canonical main/统一照明/完整运输及组合性能阻塞保留。长期docs baseline不变，诊断无生产合同变更。
