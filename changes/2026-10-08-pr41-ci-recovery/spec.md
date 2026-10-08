# PR41 当前源码 CI 与可玩性修复

状态：实施中 / Agile，用户明确授权持续诊断、最小修复、验证和处理 review，直到完成或预算停止线。

## 目标与边界

基线 head `2d144c366dbae8323516a5de9f73bb64029b12fa`，base `fba4486e433c145db658f6b1598b70c47f759c8a`。恢复专用 Codex Cloud 快照后，修复当前 CI 与真实输入旅程至可审阅、可合入状态。继承 Classic 当前 spec 的行为，不扩大产品功能，不改写 sealed evidence，不降低断言、不伪造 GREEN。禁止合并、自动合并和生产部署。

推送前再次核对远端并保留他人修改。用户已明确允许本次修复过程自动发布 Cloudflare `pr-41` 公开预览；仅沿用已有 workflow，不推 main，不触发生产发布。仅使用现有安装与网络授权。

## 行为与测试设计

1. Given 完整当前领域 fixture，When stdlib consumer projection 和 route motion 执行，Then 既有 allowlist、深复制、非法输入、14 directed edges 断言全部通过。先重现 CI 的 32 个失败，再修 fixture/import；不为不合法输入提供生产默认值。
2. Given Classic runtime 的 loaded-cell/media 合同与正式生存模式，When difficulty/lighting/special-damage 测试执行，Then 既有持久化、复活、原子编辑与死亡拒绝断言通过。先保留当前 4 个失败及根因证据。
3. Given manifest 绑定的历史字节，When 格式门禁执行，Then 不改写其内容；明确区分不可变字节与活跃代码格式检查，并验证精确 manifest 项。非证据源码格式检查保留。
4. Given 当前 source 唯一 build 的已校验 artifact，When 唯一 Classic Chromium 线路使用真实键鼠/Pointer Lock，Then 当前 C0-C5、装备恢复、V1 和 visual 既有断言通过，failure/flaky 保持失败。瞄准与视觉诊断先取正式 owner/readback 的证据，不以 timeout 扩大或补状态代替修复。
5. Given pnpm 11.25 当前锁定要求，When CI 使用 Node，Then 工具链满足其 Node 下限；核实现有 Node22.12 的实际 CI 执行和潜在不兼容，不能由云环境成功推导旧 CI 成功。

## 验收与任务

### Browser02 新证据与第二修复组

空闲机器 Browser02 仍为 FAIL：默认 `walkTo` 的 target `[33,0.5]` 在 aim 内观察到 client/server x≈35.04、z≈0.386、grounded/non-colliding，已经满足外层既有 `reachedRouteTarget`；默认分支却未传入该 predicate，继续转向直至 18 moves 耗尽。本组让默认分支同样在 helper 返回 `route-reached` 时停止，使用原 predicate/坐标/容差，不增加 observation、move、timeout 或键盘 pulse。不把 angle-aligned 视为到达；原 equipment 的额外刷新与严格双端 handoff 保留。

Visual 两次均在同一全缓存 light-ready 条件失败。缓存 `register` 无条件使邻居 dirty，即使其 Authority halo revision 完全未变；为该语义先取得 RED。本组仅允许 revision 未变的既有 cache entry 保持有效，真实 edit/residency 变化、unknown→loaded 和新 entry 必须失效。每次 drain 至多重建一个 brick，原 visual 全缓存与 worldRevision 断言不变。不宣称性能收益。

实施前回归：默认到达期间不得再发 mouse/keyboard，未到达仍走原 pulse；邻居注册但 halo 字节身份不变时只新 entry pending，真实 halo revision 改变时全部受影响 entry dirty，unload 与 stale release 仍保持资源隔离。

### Browser03 新证据与第三修复组

Browser03 的 C0/C1 PASS；C2 完成前三个原木采集/拾取，第四目标 `[45,31,0]` FAIL。trace 的反向接近 pulse 在 camera x≈41.547 时已满足旧 ack/grounded predicate，但 Authority x≈40.797、velocity x=-4.5，随后停在 x≈39.730，退出五格交互范围。等待不能以较早 ack 代替 key-up 的实际完成。本组要求 pulse 后 Authority 三轴速度为零且 camera 与 Authority 对齐，再判断到达；不提高交互距离、不放宽读出、不扩 timeout。真实轨迹值纳入确定性反例。

Visual 同一 readiness 条件仍 FAIL，30 个缓存 brick 累积重建137次而 worldRevision 固定9。为相同 chunk/halo revision 的网格资源替换先取得 RED：新 sink 应使用原有效体积；旧资源迟到释放不能移除新 sink，revision 改变必须重新计算。每次 drain 一次重建与全缓存 ready 断言保持。缓存复用是否消除实际 visual FAIL 仍待当前产物验证。

### Browser04 诊断闭包

已推送修复 source `7cb68b5c917a86afcf74f3d1641fc48cdc5e9037` 的 Browser04 C0/C1/C2 PASS；C3 的 buffered/secondStep 为 true，secondDamage 的 UI 读出为 false，随后正式快照中固定目标已移除。尚不能区分伤害结果丢失、UI 合并或完成时序。Visual 原全缓存 ready 断言仍 FAIL，缓存局部修复未关闭该实际缺口。

下一轮只补必要的只读失败诊断：Combat 保存 owner player/target 查询及 DOM observer 已观察文本；Visual 保存 pending brick、cached/current Authority halo revision。所有成功/失败 predicate、timeout、点击、输入与世界状态保持，不用 readback 代替真实操作，也不据此宣称通过。缓存诊断只在失败时构造，不增加正常每帧扫描。

修复提交的稀疏 evidence gate 审阅反例：skip-worktree 路径存在 dangling symlink 时，`existsSync` 为 false，错误回退 HEAD blob 并 PASS。用实际临时 Git sparse flag 和原四个 blob 重现 RED；应使用 lstat 拒绝所有非普通文件，再允许真正不存在的 S 路径读取精确 HEAD。

远端 run37776529858 的 deterministic/Classic headless/build 已 PASS，Architecture 在四项 formatting 修复后继续到了 ESLint，并首次暴露 sealed `git-40-canonical-discovery/manifest-closure/strict-manifest.mjs:33` 的 `no-regex-spaces`。其 SHA-256 `fd4b7d09…b412` 被原根 MANIFEST 绑定；禁止改写。仅该精确文件加入 ESLint 例外，并加入原字节门禁第五项；其它代码的规则保留，负例继续验证修改、缺失、普通与悬空 symlink 都被拒绝。

- [x] 最小恢复：Node22.23.3、pnpm11.25、Rust1.88/Wasm target；匹配 Chromium151 实际 click/key/pointerlock/mouse/WebGL2 PASS；工作区干净且远端一致。
- [x] 确定性 fixture/import RED→GREEN：stdlib47、Web12。
- [x] 历史证据格式边界与工具链核实：4/4原字节、11个门禁正反例；pnpm11.25要求Node>=22.13，CI固定22.23.3。
- [x] 第一组源码 static/deterministic/Classic headless：全 static PASS；Kernel28、stdlib1080、Classic62。此前并行负载下5个timeout保留，隔离后同源码GREEN，不放宽timeout。
- [ ] 当前 artifact 唯一 Classic 真实浏览器验收。
- [ ] 精确最终 SHA 的 CI、冲突、review 与 PR 状态读回。

### Browser05 真实键盘边沿

Browser05 在 C2 接近首个原木前失败；连续快照的 Authority/player 坐标不变且 velocity 为零，frameMs≈1.59s。生产控制器仅在 render update 采样 keys Set，100ms KeyS down/up 可全落在两帧之间。先用实际安装的 keyboard handlers 和正式 InputCommandBuffer 取得 RED：不调用 update，按下后 Authority 连续消费移动，100ms 后松开消费 neutral；预测不得凭键盘事件制造物理步。修复应通过同一 epoch/sequence/target-tick stream 即时提交键盘状态，保留 render 固定步预测与现有门禁。重复 keydown 不重复提交，UI/暂停不接受按下；松开、blur 不能留下粘滞输入，jump edge 与 movement revision 保留。真实浏览器断言、pulse、timeout 均不变。

Visual 第三个 closeup FAIL 的 pending13 中六个尚无 volume，其余为 halo unavailable→loaded 的真实变化，worldRevision 仍9，Authority 无 eviction。尚不能归因于 CPU 光照计算或 GPU 帧成本。下一轮在既有失败诊断添加 light rebuild 的实际 elapsed（last/total/max）；只记录时间，不改调度、质量、ready 或 timeout，不把计时当作性能 GREEN。

本组 RED 为实际 keyboard handler 的两例无输入包；修复后 input/prediction/transport/light/mining 六文件43例 PASS，共享采样抽取后 focused controller/prediction26例及最终 keyboard12例 PASS。全生产、根/tool/Classic 测试类型检查 PASS。首次完整 static 在 controller max-lines 处失败；按原500行上限抽取方向/按键采样后 scoped ESLint PASS，保留失败日志。新 source 的浏览器与远端 CI 仍待验证。

### Browser06 窄路线与 light 收敛

source `107c7fc984290dcfeb71a6e739f71785a46caf1c` 的完整 attempt 为2 FAIL/1 SKIP。C0-C3/V1完成；V2失败于workbench corridor `[78.5,-0.5]`，并未完成装备/C4/C5。末端双端 x≈78.499673、z≈−0.636142、velocity0，原走廊±0.08仍未满足；固定80ms脉冲可跨过该窄窗口并反复大幅转向。下一组保留所有到达/双端/grounded/collision断言、45s deadline和既有最大pulse，按当前位置剩余距离与正式player加速/最大速度选择更短的末段真实按键脉冲。不增加转向观察或mouse step，不通过状态设置移动玩家。先用原失败坐标、正式stepBody与30/60/120Hz验证固定pulse越窗和自适应pulse收敛。

Visual FAIL 时generation/meshing均0；cache30、pending3、rebuild94，三个pending均无volume。last build/apply40.4ms、累计8.0644s、max540ms，计时仅属该运行，不作性能GREEN。nearest-only调度允许重复变脏的近brick一直抢占较远新brick；为此先构造连续近halo revision变化、远brick未获重建的确定性RED。调度保持每drain最多一个真实重建、默认最近/稳定key tie-break，等待超过有限重建轮数的项按等待年龄优先以免饿死。不得提前把未重建项标ready、扩大visual timeout或改变质量；实际FAIL是否因此关闭仍待新artifact验证。

本组路线RED首轮因测试遗漏PhysicsInput.verticalIntent而无效，已保留；补齐正式input后有效RED为3 FAIL/4 PASS，30/60/120Hz均在原窗口外。自适应pulse GREEN 7/7；与原瞄准/装备handoff/光照联合验证10文件117/117 PASS。light公平性独立RED为8 PASS/1 FAIL；GREEN9/9，重复失效保持首次等待年龄，满8次真实重建后优先最老项，其余保持nearest/key。首轮类型检查暴露BodyConfig字段可选，已加入正式player配置缺失时失败的类型收窄；日志保留。尚未运行新source的Browser07，不以单测证明visual或完整旅程GREEN。

### Browser07 Authority观察与光照区域读取

source `d39d63096216d466ccf4e17affafc4cca90e3abd` 为2 FAIL/1 SKIP；C0-C3完成，V1 closed-door probe失败，未进入V2。probe实际keyDown到keyUp约1.404s，before tick24212，唯一接触观察tick24305（+93）与x70.492499正确接触面；原1250ms/75tick窗口内没有两次持续接触观察，原6tick hold断言如实FAIL。RAF等待依赖低帧率renderer而Authority持续推进。下一片仅移除读Authority碰撞观测前的RAF依赖，按新鲜physicsTick轮询同一正式只读RPC；重复tick时有界让出，原1250ms/最大physicsTick、6tick hold、位置/横向/ack/断言保留，keydown/up保持finally释放。先保留渲染帧停顿而Authority推进的确定性RED，不通过降低hold或增大期限关闭。

Visual skeleton-front closeup仍FAIL：cache29、pending18、rebuild92；13项是unavailable→loaded的真实halo变化，5项尚无volume，meshingQueue1。累计真实build/apply9.9408s、max656ms；公平性已修但未关闭实际fail。假设为每cell重复chunk/guard/string查询造成大量主线程占用；候选仅改同步派生区域读取，27个chunk guard一次验证，再复制已知体素到有界密集Uint16/loaded Uint8缓冲，未知保持fail-dark，原R8/flood/halo/revision/one-per-drain/ready/timeout/质量均不变。既有Authority mirror仍是唯一来源，不暴露其可写底层buffer、不transfer owner数据；新派生buffer归消费者，大小/有效长度/复制bytes显式记录。

性能候选在实现前冻结：A=当前逐cell getVoxelIfLoaded，B=当前同身份collision baseline经有界dense region adapter；唯一轴为输入读取方式；固定64³区域与相同27chunk/voxel/semantics/revision，包括unknown、loaded Air、光源和阻挡。预约窗口中先A/A检查两组median偏差<=15%，超线仅诊断不宣称收益；再交错AB/BA各至少8对，主要指标为完整buildLight elapsed median，B需改善>=20%，否决项为输出levels任何byte差异、缺失/陈旧chunk被当loaded、owner buffer被修改或生命周期泄漏。次要指标记录派生copy bytes/分配量与source-read count，不声称整帧/产品收益。候选不达线则删除新生产路径。若通过，还须新artifact唯一Classic端到端验证两项组合，不用微基准替代产品或比较旧非同环境Browser数据。测试先证明dense区域negative/chunk边界/unknown/guard/当前revision语义，再证明B输入实际被生产light reader消费；无新证据不重复完整browser。

本组收口：closed-door runner独立RED→GREEN与原oracle18/18；根审阅补充RPC晚于wall/tick预算两项拒绝后，同一联合6文件共48例中43有效PASS、5例region suite补验5/5 PASS，构成48例闭包。首个region suite4例RED为2 FAIL（262144而非27读取、整数加法溢出）/2 PASS；region基元GREEN4/4。完整联合首轮47/48，失败是fixture未遵循browser release cache删除与pending lease生命周期，已保留失败后用真实guard pending/release/delete/finish路径复验。Web生产types含svelte零错误/警告、Classic types、12个TS路径scoped lint与13个变更文件格式检查通过；新完整browser待验证。

性能证据01有锁与原始A/A/AB，但未绑定正式measurement declaration；保留而不冒充完整身份收据。证据02补齐local declaration、dirty candidate source/bundle digest、window identity与原始样本，预约输出为PASS/RECORDED。A/A median43.714/44.255ms、偏差1.224%；16对交错AB/BA，A44.015ms/B11.154ms，局部完整build下降74.658%，262144输出bytes完全相同。候选source digest `624b774362cc0c3f1fa21bf9b9efd2d671ca80b2b703a8d7c857a009243867cd`，benchmark bundle digest `6d8c9ca28df83a5654fee37ffb48247b5e14ac6a6479570aee41365c94c9867c`。64³派生copy786432bytes、owner transfer0，窗口内没有其它测试/build/browser；不推导整帧收益。生产batch仅在实际BrowserAuthority mirror port可用时启用，同步捕获每chunk的现有guard，复制行到consumer-owned buffers，不引入可写owner泄漏或长期新缓存；缺port的既有严格fixture保持原逐cell读取，不制造loaded默认值。block-light consumer测试明确禁止退回per-cell并逐byte比较同源control；negative/boundary/unknown/Air/guard/stale/release/alias反例保留。

## 模型与预算

主力按用户指定 Sol/high/default；一个有界独占测试 fixture 子任务使用精确 Luna/medium，不再委派。禁止 ultra/Astra 开发。所有工作共享每周总额度40%上限，保守剩余约60%停止；本云工具没有真实周额度 UI 查询，依赖主对话提供读数（13:39 UTC剩余94%，包含同账户其他任务），不由 token/credit/API 金额换算百分比。收到停止即保存进度。

## Delivery Snapshot

实施中。新运行使用独立 ID。静态/构建不替代产品验收；旧 Browser25 不为本 head 背书。长期 docs baseline 暂不更新，待修复事实确定后记录理由。
