# 观察取帧 A/A 失败 checkpoint86

精确 source2b17241b / artifactefd549f3，仅私有、暂停静止生产 renderer 诊断。机器锁 window `0edf2443-aa60-4e48-b827-e704a43bd293`（首次误用未被 wrapper 消费的命名变量，真实 UUID 以 lock/measurement 为准；没有伪造别名身份）。正式生产、CI、trace/截图配置和原验收不变。

四段 A 同一截图开启配置、每段30s、段前5s稳定。真实帧 median 为416.7、300.0、283.4、283.3ms；A1组350.05ms / A2组291.65ms，差18.2017%超原15%线，FAIL。场景姿态/视角、世界revision、geometry/queues、WebGL2/quality/驻留等固定字段全部一致。窗口FAIL、measurement RECORDED；AB严格NOT_RUN。

完整raw、四个trace、脚本和日志均保留在私有`/workspace/pr41-recovery-20261008-root-01/observer-*-86-01.*`，validation记录准确摘要与身份。帧rAF为同环境轻量观察，不是完整C0–C5或Authority持续消息性能；未删任何正式trace或放宽门禁。明显下降仅支持再核对控制稳定过程，不证明GPU shader/JIT根因，也不得挑后两段重写为A/A通过。

本轮候选未采纳，不宣称截图关闭收益。旧AA失败保留；如新实验，须在完整取帧路径预热后重新预注册，原15%线保持。长期docs baseline不变：诊断无生产合同变更。
