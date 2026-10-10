# CI407 精确终态

对象 `34fee5f13d8abdf95e8b0f1a2307fc7844fc6bcc`，[run38028144687](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/38028144687)。正常feature push触发，未重跑/取消前驱。

- architecture、deterministic、Classic Headless、production build、static SUCCESS。
- Chromium FAIL；Cloudflare preview SKIP，无生产部署。
- 主旅程两次完成V2装备流程（8.6m/8.1m），C4未通过。首次900000ms总限和原20ssettle失败，诊断x118.16/onGround=false；重试return72.5原90s路线超时，x76.7606/onGround=true/velocity0，当前附近Authority/render revisions匹配。C4完整生命周期及C5不写PASS。
- 视觉用例56.5s PASS。普通矿车两次保存重载start-card原10000ms失败（用例26.1/26.4s）。本地88 PASS不能覆盖这些远端失败。

decoded job log与精确两条motion保留在云私有独立路径；首次大参数写日志被ARG_MAX拒绝，无文件产生，第二次分块写成功。公开摘要不复制整trace或改写sealed evidence。

GitHub当前results/trace artifact11661877018为416824261bytes、digest sha256:7809e3b1bbb5b779396b964b02950a1180ddee19536a750f20580cf6767e4ad3；完整HTML11661911946为430747773bytes，7天保留。connector返回file_00000000407c8209a56b308df51e4cc8，但Library materialize仅返回同一sdmntprjapaneast.oaiusercontent.com signed URL、workspace_path=null；该域名已有HTTPS代理403/TunnelFailed证据且授权待答，未新增网络权限或绕过。ZIP未在云环境下载/校验/解包，不能声称已查看其中矿车失败UI。

源码发现低核心提示重载确认遗漏，仍须明确反例与实际CI证据，不宣称CI407根因已确定。PR保持Draft/不可合入；性能候选82仍缺整帧/组合正式准入。
