# MC 宿主上的真实远端环境与推送部署

本附件扩展 [Node 正式方案](spec.md)：Node 可玩闭环完成后，在现有 MC 宿主上部署隔离的 Seedlands 测试服务，并由 GitHub CI 推送更新产物。**本轮仅完成现场只读核验与方案修订，没有安装服务、修改网络、配置 GitHub secrets 或执行部署。** 新附件纳入精确 hash 审核，原审核值失效。

2026-09-07 修订：下列现场事实来自上一轮只读核验，本轮未重新探测。HTTPS/WSS 改为参考与兼容入口，正式游戏传输等待[网络选型 N0–N4](network-selection.md)，不能把部署方便当作已经选定 TCP 的依据。

## 一、来源、当前事实与待验证项

已使用 `read_thread` 读取「Hermes Agent 开发机运维」（`019f3d40-8c34-7501-9808-8188a14998bb`），取得 PVE/SSH 跳板及权限边界背景；MC/DDNS 方案以用户本轮描述和下列现场结果为依据，不将历史拓扑视为当前状态。

本轮通过全局 `pve-hermes-remote-ops` skill 执行 `probe`，使用已核验的 PVE IPv6 入口，经 `pct exec 105` 只读检查目标；没有读取 ddns-go 配置、私钥、口令、环境文件或 Cloudflare API 凭据。

| 项目          | 本轮已核验事实                                                         | 解释                                                                       |
| ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 目标          | PVE 上 CT105，hostname `mcs`，运行中的非特权 LXC                       | 用户称虚拟机，实际不是 QEMU VM；不误部署到 CT107 Hermes 或 PVE 宿主        |
| 系统与额度    | Debian 12，x86_64；8 核配置、16 GiB 内存、8 GiB swap                   | 不是八个独占物理核；要与 MC 共享容量                                       |
| 存储快照      | 根卷配置 512 GiB，文件系统约 284 GiB 可用；PVE local-lvm 使用约 56.08% | 仅本轮容量快照，不是长期配额或备份证明                                     |
| MC 与管理端口 | Java 25565；MCSManager 23333/24444；ddns-go 9876；SSH 22               | 均有监听；本轮不改变这些服务和端口                                         |
| DNS           | `mc.bieji.fun` 有 AAAA，当前无 A；AAAA 与 CT105 全局 IPv6 一致         | ddns-go 服务运行中；Cloudflare 作为 DNS 服务来自用户说明，未访问其账户配置 |
| 外部入口      | 本机到 `mc.bieji.fun:22` 的 IPv6 TCP 探测成功                          | 仅证明本机路径；未验证 CI runner 路径或专用部署账号认证                    |
| 拟议端口      | 8443 不在本轮目标监听清单中                                            | 尚未占用/放行；实施前再次查冲突、IPv6 防火墙和入口可达性                   |

待落地前确认：实际 runner 的 IPv6 egress/SSH 认证、目标 SSH 主机公钥、有效 TLS 证书与续期路径、精确端口、最小部署账号和服务账号、服务资源预算、应用检查点/PBS 备份、真实客户端所在网络。服务器访问 GitHub 不可靠是用户提供的部署约束，本轮没有主动访问外站验证或改动其代理。

## 二、同一台宿主，独立服务与候选公开端口

拟使用 `https://mc.bieji.fun:8443/` 和同源 `wss://mc.bieji.fun:8443/session`，直接走 AAAA 到 CT105。域名和端口只是提案；首次实施核验后写入部署配置，冲突时选择另一空闲高端口并更新证据。

沿用现有 DNS-only 直连思路，不改变 MC 记录、不切换 Cloudflare 代理状态、不改 DDNS 更新范围。DNS 更新本身不开放路由/防火墙，也不提供 HTTPS 证书。若未来使用 Cloudflare 代理，其端口和连接路径需重新验证并单独标记代理测试组；普通 DNS 代理不能被当作任意 SSH/FTP 中继。[Cloudflare 端口说明](https://developers.cloudflare.com/fundamentals/reference/network-ports/)、[代理限制](https://developers.cloudflare.com/dns/proxy-status/limitations/)

T0 参考在 Node HTTPS 入口终止 TLS 并挂载 WebSocket，证书由宿主既有或单独配置的证书流程提供，服务只读证书；不把 Cloudflare token 塞入游戏进程。没有有效证书时保留为待配置，不通过关闭浏览器校验或自动退回明文解决。证书覆盖 `mc.bieji.fun`，端口不改变证书域名匹配。

T2 WebTransport HTTP/3 入选时，同数字 8443 的 UDP 是另一条监听/防火墙规则，须独立核验公网 UDP、实际 datagram 和可靠流能力。Node HTTPS + `ws` 不提供这条路径；具体 HTTP/3 adapter/可能的 native 或 sidecar、资源限制、证书加载、离线依赖、启动/停止/回滚都要随采用结论补全，不预先安装。WSS 兼容入口保留；部署与外部 smoke 同时验真默认传输和 fallback，强制 T2 测试不能静默落到 WSS 后报告成功。

同端口提供本次 release 配套的测试前端及静态资源，使用独立的 `/` base 构建，避免 GitHub Pages 的仓库路径 base 被直接挪用。只服务固定静态资源目录，拒绝路径穿越和目录浏览，不能访问 release 外的文件。现有 GitHub Pages 可继续连接该服务，但同源入口是版本配套的真实远端验收入口；握手仍校验规则版本，不能仅因同源而信任玩家。

拟议隔离结构：

| 对象                                                 | 用途                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `seedlands` 非 root 用户、`seedlands-test.service`   | 只运行游戏，不能管理 MC/MCSManager/ddns-go                  |
| `seedlands-deploy` 用户                              | 只上传 release staging、查询部署状态和调用固定激活/回滚入口 |
| `/opt/seedlands/releases/<release-id>/` 与 `current` | 不可变代码/配套 Node runtime/前端，按 release 切换          |
| `/var/lib/seedlands/test-world/`                     | 独立的持久世界，代码部署不覆盖它                            |
| `/etc/seedlands/`                                    | 配置、证书引用和口令文件；不进入产物                        |
| `/var/lib/seedlands/deployments/`                    | release 状态、检查点引用和发布/回滚记录                     |

建议初始服务预算为 `CPUQuota=200%`、`MemoryHigh=2G`、`MemoryMax=3G`，计算池维持基础配置；均为待容量验证的起点。内存限额覆盖 Node 子进程与 Worker，不给扩池实验无限资源。持续记录 MC 负载和宿主争用；不得停止 MC 来制造好看的结果。高并发性能实验留在受控环境，CT105 优先承担网络正确性、可运维性与小规模 soak。

计算全部上移后要验证该候选配额能否承担相同工作量，遵守[A13](performance-guardrails.md)。若达不到 tick/进展/可玩 SLO，先定位排队、网络或宿主争用并解决，不能降低模拟频率/视距/实体数量后宣称同负载不退化。扩大资源会影响 MC 共存，需要重新容量评估；CT105 证据不足就保留该环境未准出，不用开发机成绩替代。

不能将测试服务加入 MCSManager 的任意命令面板或复用其账号来省接入成本。首次准备账号、systemd、证书/防火墙时精确限定 CT105、端口、文件和服务，先备份再修改；本轮的方案讨论不是已完成的远端变更。

## 三、CI 到服务器的传输方向

选择 **CI 构建并通过 SSH/SFTP 推送**。普通 FTP 不用于本方案；无需再开 FTP 服务和被动端口。目标机不需要 `git pull`、`npm install`、访问 GitHub Releases、拉镜像或运行 GitHub runner。

```mermaid
flowchart LR
  Main[main 的 CI 与 Pages 部署成功] --> Build[同一 SHA 的 Linux x64 完整产物]
  Build --> Gate[部署 workflow：来源/版本/网络预检]
  Gate --> SSH[SSH / SFTP 推送]
  SSH --> Stage[CT105 隔离 staging 与校验]
  Stage --> Activate[检查点备份 / 切换 / 启动]
  Activate --> Remote[外部 HTTPS + WSS + 浏览器验证]
  Remote --> Result[部署状态 / 失败恢复 / 证据]
```

**先验证 runner 真实可达，不能预设 GitHub 公共 runner 一定有 IPv6 出网。** GitHub 主站的 IPv6、Actions IP 列表和 runner 内核支持 IPv6，都不等价于该 job 能到 CT105。官方镜像仓库有 IPv6 连通性问题记录，本轮未从实际 runner 验证，不能把历史 issue 当作当前所有 runner 的永久结论。[GitHub runner 参考](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[官方镜像仓库问题记录](https://github.com/actions/runner-images/issues/668)

部署预检依次验证 DNS/TTL → IPv6 默认路由与目标 TCP 22 → 固定 host key 的专用 SSH 认证 → 精确服务目录/架构/空间/锁 → TLS/WSS 外部路径。目标 AAAA 解析在每次 job 和重试重新进行，不写死当前动态 IPv6；host key 不随 DDNS 地址变化自动替换，禁止 `StrictHostKeyChecking=no` 或把在线 `ssh-keyscan` 直接当信任根。主机公钥在首次配置时经 PVE 管理通道核对后写入 CI 的 known_hosts。

若实际 runner 无直达 IPv6：首选使用已有且经确认可用的双栈 SSH 跳板，从 runner 的 IPv4 入口跳到目标 IPv6；当前没有确认这样的入口，NAS/PVE 的 IPv6 路径不能自动充当双栈跳板。次选一个可同时访问 GitHub 和目标的独立部署 runner/受限组网入口。组网需要单独核对身份和可达性，不擅自改动 Tailscale 现有路由。两种 fallback 都只承担上传，不让公网游玩经 SSH 隧道，避免污染延迟结果。[GitHub 私网接入说明](https://docs.github.com/en/actions/concepts/runners/private-networking)

不把 self-hosted runner 安装到「无法访问 GitHub」的 MC 服务器来假装解决这个问题：runner 接单和更新本身需要出站访问 GitHub。[GitHub self-hosted runner 说明](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)

## 四、CI 触发、产物和权限

现有 `.github/workflows/ci.yml` 在 PR/main 运行静态、构建、Chromium，main 成功后部署 Pages；整个 workflow 使用 `cancel-in-progress: true`。因此拟新增独立 `deploy-node-test.yml`，由 **CI and Pages 的成功 `workflow_run`** 触发，显示单独的 Node 远端部署检查；避免新 push 取消正在切换服务的部署事务。

必须同时满足：来源仓库是本仓库、上游事件为 push、branch 为 main、结论 success，静态/Node 产物测试/浏览器/Pages 的必要作业实际成功。PR 和 fork 的产物绝不进入有 secrets 的部署；`workflow_run` 可获取高权限，不能只检查 workflow 名字就信任来源。[GitHub workflow_run 说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)

部署 artifact 从上游 **run id + head SHA + artifact id** 定位，不能取名为 latest 的任意包；下游默认 `GITHUB_SHA` 不当作目标代码 SHA。Node 产物在上游可信构建 job 生成并验证，部署 job 只下载、检查、上传，不部署时重新从 main 构建一份可能不同的内容。

产物包含：编译后的 TS/Node ESM、`ws` 等必要运行依赖、匹配 Debian 12/Linux x64 的固定 Node runtime（或已验证离线 runtime 包）、同 SHA 测试前端、启动入口与 manifest。服务端运行依赖随包交付，这是部署产物，不将 `node_modules/` 或 `dist/` 加入 Git。manifest 记录 source SHA、artifact digest、Node 版本/架构、文件哈希、协议/存档版本、构建与测试 run id；离线干净环境启动验证不能使用构建机的开发依赖、Vite 或网络下载。

部署 job 使用专用 `seedlands-remote-test` Environment，仅 main 可用，secrets 只交给该 job；上游 PR/测试没有部署密钥。一次完成初始化和开启自动部署后，正常 main 更新不要求每次人工重新确认。保留手动重试/回滚入口，并限制为可信 main 工作流和曾验真的 release。复用仓库 action SHA pin 原则，不引入不透明第三方 SSH action。

CI 私钥只对应 `seedlands-deploy`，不放 PVE/root/MC 账号凭据。上传可用 SFTP/SSH 标准工具；部署账号限制到 staging 和固定 wrapper，不允许任意 sudo、shell 作为 root、端口转发或读取其他服务的秘密。需要 root 的小型 helper 由管理员持有，严格校验 release id、目录和 digest，绝不以 root 执行上传脚本/包钩子；游戏代码始终以 `seedlands` 运行。

部署 concurrency 固定为该环境，`cancel-in-progress: false`，远端还有独占部署锁和持久状态。运行顺序不能只靠 GitHub 排队保证：激活前重新比较 candidate SHA 与允许部署的 main/已部署代次，旧 run 迟到标 `SUPERSEDED`；回滚是显式模式，不能被旧自动 job 当作普通前进部署。手动取消/runner 失联也必须可恢复，不依赖 SSH 会话一直存活。

## 五、更新、验证与回滚

采用单世界的短暂停机部署，首版不做两个进程并行写同一存档的蓝绿发布。每次更新状态如下：

1. **RECEIVING / VERIFIED**：上传临时文件，验证完整 digest/平台/manifest 和存档兼容性；解包在非 root staging，拒绝路径穿越、越界链接、设备文件和过大展开体积。传输中断不影响 current 服务。
2. **PREPARED**：候选使用独立临时测试世界在本机 loopback 自测，不能写持续测试世界；确认当前服务可冻结检查点，记录旧 release/config 引用与应用一致的存档备份。PBS 的存在不代替本次应用检查点。
3. **DRAINING**：通知连接即将重启，停止新写入，完成已接纳动作，发布最终 durable checkpoint 并停止旧服务。未成功保存就不切换；超时保持失败和旧 release 可恢复。
4. **ACTIVATING**：原子切换 release 指针，以专属用户启动，同一数据目录独占锁保证只有一个写者。激活由持久的本机有限部署任务执行，SSH 断开后仍完成或回滚并记录状态。
5. **VERIFYING**：服务先处于验证维护态，禁止普通玩家写入；验证进程状态、release SHA、存储可写/恢复、tick，随后从外部 IPv6 TLS/WSS 认证、读取真实基线与状态。合成移动/编辑/保存重启测试在隔离 canary 世界执行，不在有人使用的世界偷偷改方块。
6. **SUCCEEDED**：外部证明匹配 SHA 且满足短 smoke 后开放持续世界。对旧连接返回新 epoch，让客户端完整 resync；保留上一 release、配置与检查点备份，报告部署/恢复时间。
7. **FAILED / ROLLED_BACK / RECOVERY_REQUIRED**：候选启动或外部验证在预算内失败时，若尚未开放写入且确认存档兼容，停止候选、回切旧 release，并验旧服务恢复。存档不兼容时需要完整恢复已备份检查点；无法证明安全则停在恢复态，不能反复重试或默默删除新数据。

验证维护态到开放之间需远端部署任务收到外部成功凭证（绑定 deployment id、SHA 与过期时间）；未收到则按有限超时回滚，避免 runner 消失留下无人管理的候选。首版不做数据格式自动迁移；候选若要求新存档 schema，拒绝自动部署，先走专门迁移合同。已经开放写入后发生故障，不自动用旧检查点覆盖新玩家进度；先停止写入保全，再选择兼容代码回退或显式恢复。

GitHub 最终状态必须区分：发布成功、发布失败但回滚成功、回滚失败、runner 网络不满足、测试环境暂不可达、过期 run。不能因 SSH 返回 0 或 systemd active 就打部署成功。远端任务写可查询日志且不含秘密；CI 失败保存部署 id、各端 SHA、durable checkpoint、探针错误及恢复状态。

## 六、真实网络验证与实验归因

把该环境作为 `WAN-direct-v6` 层追加到原实验合同，不替代同机/LAN 的受控宿主 A/B。CT105 与 MC 共用 CPU、内存和磁盘，自然 WAN 时延还包含运营商路径；单次快慢不能归功于 Node runtime 或某个 feature。

| 场景                        | 操作与正确性要求                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常远端游玩                | 从至少一个真实外部 IPv6 客户端进入，真实键鼠移动/跳跃、跨 Chunk、破坏/放置、保存/重进；位置校正、碰撞、库存与回执一致                                           |
| RTT/jitter 与拥塞           | 记录生产 request 往返 p50/p95/p99、丢失连接/重试率、输入确认、校正幅度和频次、frame、队列与 server tick；跨机单向延迟不直接相减                                 |
| 短暂离线                    | 断开测试客户端 2/10/30 秒，权威输入租期内清零，世界继续运行；重连成功则重建基线，超过自动重试预算保留手动恢复，动作不重复执行                                   |
| 部署重启/进程故障           | 旧 epoch 迟到数据无效；未确认动作显示未知并查询，不自动重复 craft/place；恢复正确 durable checkpoint                                                            |
| DDNS 与 IPv6 前缀变化       | 观察自然地址变化；重连重新解析域名，TLS 校验不放宽。可在隔离测试解析器中模拟变化，不改共享 MC 的生产 DNS 或重启路由器制造故障                                   |
| 受控网络波动                | 在专属测试客户端 network namespace/隔离代理中注入延迟、jitter、限速、断链；若做 packet loss，限定测试流且记录 TCP 重传影响。不得在 PVE/CT105 共用网卡施加 netem |
| TCP/WS 顺序                 | 同一连接的可靠有序语义与跨连接迟到结果分开验证；不把应用层消息乱序注入说成真实 TCP 帧会乱序交付                                                                 |
| IPv4-only/TLS/口令/版本错误 | 清晰报连接失败或可识别的协议错误，不自动退到本地世界、明文或关闭校验。浏览器缺少底层错误原因时只提示可能的 IPv6/地址问题，不能伪造精确网络诊断                  |
| MC 共存                     | 采样 MC/MCSManager 的资源与已有健康指标，证明测试部署/故障注入未重启或覆盖这些服务；明显争用时停止扩负载而不是改 MC 配置                                        |

每次自动部署执行短 HTTPS/WSS/版本/基线 smoke（目标 1–3 分钟，硬预算另由实现记录），首次正式远端准出增加真实浏览器旅程及 30 分钟 soak；随后做三个不同时段、每次至少 10 分钟的自然网络样本。没有自然发生的 DDNS 变化记 `NOT_OBSERVED`，只给模拟证据，不捏造真实故障经过。长样本不要求每次 main 部署重跑，也不在本轮创建定时任务。

CI runner 若仅能经跳板上传，公网 smoke/浏览器验收需要另一个有原生 IPv6 的外部执行点；通过 `ssh -L` 连到 loopback 只能验证服务，不算公网直连延迟。若缺少该执行点，发布保持「外部验收待完成」，不能改成 SSH 本机 curl 后宣称 WAN 验收通过。

## 七、实施门禁、用例与当前状态

这次用户补充明确了未来部署方向；当前仍为设计阶段。首次远端准备前提交具体目标、端口、权限、网络/证书变更、备份与回滚方案，并核对当时已有授权；不对已明确授权的同一操作反复询问。GitHub secrets 配置与正式服务部署尚未执行。

| 用例/准出                                        | 计划证据                                                           | 当前状态                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| R01 目标/PID/端口/DNS 与 MC 边界                 | Manual supplement（只读现场）                                      | CT105/AAAA/SSH TCP 已核验；8443/TLS/CI 路径未验证               |
| R02 workflow 来源、SHA/产物匹配、旧 run 与串行锁 | `tests/scripts/node-deploy-contract.test.ts`，Static / Vitest      | 待实施前先 RED；失败/取消/PR/fork 不能激活                      |
| R03 离线完整包及部署事务                         | `tests/node/release-deployment.test.ts`，Vitest / Build            | 待 RED；无网络启动、上传中断、digest/路径拒绝、各阶段中断与恢复 |
| R04 公网预测/重连/重复动作/部署恢复              | 当前 change 的 `e2e/remote-network.spec.ts`，Playwright-change     | 待实施；真实外部入口与受控异常分组                              |
| R05 远端状态与失败提示                           | 当前 change 的 `midscene/remote-recovery.yaml`，Midscene           | 待实施；错误可见、恢复可操作、无静默本地分叉                    |
| R06 实际 CI→远端闭环与 MC 共存                   | Build / Playwright-change / Manual supplement / Static（版本记录） | 未执行；必须成功与失败回滚各一次                                |

落地顺序：Node/P2 GUI 本地闭环 → R01 网络/证书/容量与有限初始化 → 同一离线包手动受控部署并验回滚 → 接 CI 推送与短 smoke → WAN 浏览器/自然波动证据 → 维护长期测试环境。F1–F4 性能矩阵可在受控设备继续，不以等待全部优化完成阻塞首个远端验证。

以上是正式 P2R 交付顺序。N4 所需最小可玩/WAN 选型探针可以先于正式 GUI/自动部署执行，避免循环依赖；探针仍需隔离与目标准备，不改变共享 MC 网卡。最终 R01/R04/R06 必须包含选定传输、UDP（若采用）与 WSS fallback 的真实证据，当前均未完成。

实施完成后将稳定的目标、部署/恢复入口和网络限制写入 repo `docs/` 并在 AGENTS 按需暴露指针；不要复制含敏感信息的全局运维 skill 或把动态 IPv6 当长期基线。当前本附件只记录已核验的事实、决策与验收约定。
