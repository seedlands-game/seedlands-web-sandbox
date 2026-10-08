# PR41 当前源码 CI 与可玩性修复

### Browser12 持续指针输入补验与 CI 元数据边界

worker 输入租期在 service 和新包准入时都检查；期限内没有 service 时，排队续期也不得复活已过期手势，必须真实新 mousedown。实际 release、blur、PointerLock 丢失、hidden 和 dispose 经已安装 Controller 输入链取消后，独立推进 Authority 不得新增攻击，已开始 swing 保持原结算。

CI1df 的 Chromium 作业于16:57:42开始 Harness，17:05:07才开始测试，并记录 GitCommitInfo 全 PR diff 超时。已安装 Playwright 1.62.1 的 gitDiff 实现先无filter fetch PR base，再完整diff；这会重新下载 sparse 排除的历史 blob。仅关闭可选 HTML git diff 元数据采集，commit 元数据保留，source SHA/digest/lock/artifact identity 和实际三测试 canonical receipt 原门禁保留；不提高 job/test timeout，不改变重试或验收选择。

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

### Browser08 真实转向观察与护甲覆盖

精确source `3d00b3b93a32ef433b3d181cafedf200944b9ef6` 的Browser08：主旅程FAIL、视觉PASS、modular按Classic产物SKIP。C0-C3及V1全部完成；V2仍在workbench corridor `[78.5,-0.5]` 的原45s deadline失败。末端Authority/player一致于x78.673859/z−0.609932、静止/落地/无碰撞；反向修正连续80px真实mouse move各等待两次RAF，原窗口内未完成最后转向。先构造渲染帧延迟但真实mousemove已更新yaw的RED。候选仅为route转向去掉与其读取无关的双RAF；默认体素/实体/视觉mouse helper继续等待双RAF。保留真实PointerLock/鼠标事件、80px上限、18moves/19observations、失败分支、45s deadline、Authority静止及原位置窗口；不设置yaw、位置或世界状态。转向仍读取实际controller yaw，不认为发送事件就证明角度完成。新source完整Browser仍须验证，原PASS视觉不覆盖其它source。

原V2要求全部16件护甲，不以四铁UI和五件metadata测试替代。本组冻结当前Classic平衡literal oracle：leather helmet/chestplate/leggings/boots = 1/3/2/1 points、max durability55；iron =2/6/5/2、165；gold=2/5/3/1、77；diamond=3/8/6/3、363。固定registered zombie-claw基础3，单件损失分别为3乘以(1−points×0.04)，测试逐行写literal预期而不从registry推导oracle。正式Authority inventory-pointer pickup→错误槽拒绝且视图不变→正确槽装备→持久化新实例恢复；完整Classic注册combat producer解析唯一hit、耐久3→2并snapshot恢复。不得改用直接applyDamage；此组headless证据不代表UI/death-drop/respawn矩阵或全物品链完成。

本组初始route render依赖RED为1 FAIL/1 PASS：原18次转向额外双RAF累计28.8s；移除route专用等待后原合同等4文件40/40 PASS。补充实际walkTo两种refresh路径与实际controller mouse handler无render时的方向捕获，联合有效42例通过（原不变25例与补验17例）。护甲33例初跑即PASS，属于新增覆盖，不制造行为RED；首次格式FAIL已修。Luna并发较早types读到mouse helper旧签名而FAIL，根最终Classic types与五个TS路径scoped ESLint PASS。原trace十进制字面量触发两轮no-loss-of-precision FAIL，保留日志；改为Number原始字符串读取，不更改坐标或lint规则。完整Classic headless含新矩阵24文件95/95 PASS。将新护甲文件加入原headless命令和Classic test types，不能只运行一次然后让CI遗漏。

### Browser09 输入投递时钟与护甲死亡闭包

精确source `991b4b435c3afb08569cc5dddc1973d530a19a57`：Browser09主旅程FAIL、visual PASS、modular SKIP。资源条全部放置后，首次木材采集前返回 `[78.5,-0.5]` 的45s窗口失败；末端Authority约94.999734、client约95.099731，Authority静止但render呈现滞后。约844s时prediction累计12335次authority-resync；正常本地传输的inputLead只有2ticks，输入基于已排队的旧snapshot tick，真实键盘边沿虽即时捕获仍可能已被Authority消费。下一候选只修输入调度估算，不修改Authority位置、世界状态、固定physics步长、输入拒绝规则或路线期限。

冻结方案：Browser Worker在周期snapshot envelope附可选跨同浏览器realm的单调绝对capture时间（performance.timeOrigin+now），不加入AuthoritySnapshot、持久化或确定性owner。Browser client仅在原epoch/order gate接受该snapshot后绑定时间；新的已接受但无时间消息清除旧估算，旧epoch/重复/倒序不得覆盖。输入调度基准为当前snapshot tick加采样年龄对应的floor ticks，年龄有限且非负、上限2000ms；paused不外推，缺失/非法/未来时间回退原tick。只作为PlayerInputStream的target基准，预测body/reconcile仍使用原snapshot；既有配置的传输lead保留。restore/new epoch清除时钟，所有原late/out-of-order/too-far-ahead与256pending门禁不变。该估算不是Authority tick或性能收益证据。

先用stale snapshot tick100、Authority consumed130、input scheduling base130构造RED，期待capture与render输入target132并被原InputCommandBuffer接受；补充30/60/120Hz、paused、无时间、未来/NaN、年龄上限、旧epoch/倒序/restore清除的边界与实际BrowserClient→controller连接。新artifact完整browser必须验证，不以helper单测替代产品验收。

护甲闭包另用原16行literal balance覆盖注册zombie-claw致死、inventory/cursor/crafting/armor四来源只掉落一次、耐久3→2、死亡存档新实例恢复（epoch更新/lifetime保留）、死者拒绝后续攻击、正式respawn健康20且不恢复旧armor、再次存档无重复掉落。初始health1仅fixture配置；死亡必须由注册Combat producer结算，不直接applyDamage。先运行新增覆盖，如原实现已满足则记新增PASS而不制造RED；加入正式headless选择和Classic类型检查。

本组确定性RED分别2/16与3/17（旧target102，预期132），修复后capture/render/interrupt维持同一序列。7文件81/81 PASS包含原0/50/150ms transport fault覆盖、真实键盘边沿/neutral、epoch/order/restore时钟、护甲16件死亡闭包；补充world-item位置/lifetime保存验证后仍PASS。stdlib与Web生产types、Classic测试types通过。初次scoped ESLint因有效行数500上限FAIL，保留日志并按已有职责拆出水体采样和session control、独立snapshot envelope type，不降低门禁。最新 `991b4b43` CI run37794086450终态FAIL：architecture/deterministic/headless/build/static PASS，Chromium FAIL，preview SKIP；CI首次start-card10s超时，重试combat仅5/5/2伤害且未见衔接/第二击，visual两次原20s未ready。云内visual PASS不覆盖CI。连接器artifact下载引用可得但本云读取403，暂以job日志确定症状，根因尚未关闭。

最终补验：新增原too-far-ahead拒绝反例13/13 PASS；输入相关6文件66/66 PASS，护甲死亡16/16构成82例有效闭包；完整Classic headless25文件111/111 PASS，CI选择/冻结证据12/12 PASS。测试专用types首轮因配置位于仓库外无法解析type roots失败；修正配置后暴露现有fixture缺craftingGrid/matched recipe IDs/完整frontier与直接改readonly snapshot，已修为完整fixture和测试自有副本，最终专项types PASS。原断言、输入limits与sealed bytes保持不变。新artifact/browser和新SHA CI尚未运行，不能宣布可合入。

本组审阅补充structured-clone非法metadata反例：BigInt原先先减法而抛TypeError，1 FAIL/16 PASS的RED已保存；改为先验证finite number再计算年龄，17/17 PASS。该拒绝仅回退调度tick，不修改snapshot或Authority门禁。

### Browser10 内外路线进度交接

精确source `98b9a115376fc7645c5c78949d1460d33d16c786`、build10的Browser10为2 FAIL/1 SKIP；C0-C3/V1完成，V2首次workbench corridor失败，visual skeleton-front仍未ready。实际轨迹在一次静止pulse后从 `[78.4337,32.6,-0.4564]` 到 `[78.5587,32.6,-0.5803]`，越过目标x但z超出原±0.08走廊。内层walkTo继续以KeyW作约180度转向，约26秒后回到目标另一侧，又开始反向转向并耗尽45秒；外层已有KeyW/KeyS选择逻辑未收到这次已完成pulse的进度。

本组先验证实际walkTo与实际equipment driver组合的RED：完成、确认ack、静止、落地且无碰撞的pulse越过请求方向的x边界时，应将双端位置仍在既有±0.45 x邻域的进度交回外层，让外层按当前x选择下一次真实KeyS/KeyW；返回进度不表示到达，z不在±0.08内必须继续纠偏。仅equipment路线启用此交接；普通walkTo语义不变。保留最终双端到达、原0.06/0.08/0.45窗口、45秒deadline、80ms上限、真实键鼠及所有新鲜性/grounded/collision门禁。禁止以更宽z窗口作为成功或增加deadline。visual失败pending13中9项真实halo变化、4项尚无volume，下一修复组另行建立因果证据。

### CI连击输入与渲染时钟隔离

CI991正式query-player-state给出lastResult `sequence:3,comboStep:0,damage:2`；目标12HP收到5/5/2，三次均第一击。源码wood-sword第一步windup0.18/hit0.08/recovery0.24，衔接窗口0.18–0.50s；实际controller仅render update重复攻击，frame约447ms。下一定向RED使用真实安装mousedown、完整Classic registered Combat和单调假时钟：render停止，Authority仍按60Hz推进；200ms真实按住重复应在窗口内buffer第二步，结果必须literal第一击5、第二击7。对比旧447ms渲染驱动可作诊断，不调Combat时间窗，不使用绕过controller的攻击或写combat状态。

候选仅将按住指针的攻击重试按200ms单调deadline排程到有界主线程timer；render与timer共享同一deadline，晚callback每次最多一次，不补积压。每次读取当前真实控制器yaw/pitch及摄像机位置、现有目标/range/LOS，正式Authority仍决定接受/衔接/伤害。鼠标松开、失焦、PointerLock丢失、隐藏、UI/暂停、模式变化、world销毁/控制器dispose必须停；矿物破坏的elapsed进度继续由原render/Authority路径负责，timer不得额外推进采掘。真实键鼠与HUD连击完整browser仍为最终门槛。

### CI98 检出超时与持续回归

run37800926606的Classic headless于15:27:36开始无filter的depth1 fetch，15:42:36在既有15分钟job期限被取消，测试未运行。Chromium于15:37:31开始fetch，15:43:33才checkout，15:45:01开始旅程，16:02:43被取消；终态cancelled不冒充测试FAIL或PASS。历史大证据整仓下载是独立CI环境问题，不能通过提高测试期限掩盖。

保持checkout的原pinned action、精确ref、architecture/deterministic fetch-depth0、其他depth1及job权限/期限。使用该pinned action的non-cone sparse-checkout（源码自动fetch blob:none），代码/docs和历史spec保留；archives/reports/harness产物与历史evidence只按需Git blob取。直接被legacy测试读取的pre-death-v4-identity精确文件明确物化；新repair evidence物化。五个sealed原字节门禁仍运行，缺失只能用skip-worktree HEAD精确blob，不能删manifest或跳过验证。以实际Git临时小fixture测试每个checkout block的patterns：保留代码/docs/spec与必要fixture，排除历史大证据，缺失项保持indexed S且HEAD原blob仍可取，不复制真实历史。

将本组真实route handoff与held attack定向合同加入原Classic headless持续回归入口并纳入测试types，保留原25个完整Classic合同，不替换或减少既有覆盖。根因图单独记录已证明/待证明与证据边界。

本组checkpoint：有效held attack RED在第三次fixture完整后取得，前两次Structure port/target predicate fixture失败保留不计行为RED；GREEN联合5文件50/50、采掘另3文件34/34、单调旧gate补验14/14。完整新headless入口27文件125/125 PASS；Web生产types零错误/警告、完整Classic types（含新held attack）与9个TS/MJS scoped ESLint PASS。路线新fixture类型首轮FAIL已补齐严格字段；CI sparse首轮新evidence未物化FAIL后修正，13/13门禁PASS。根有界审阅输入生命周期、共同deadline、最终路线窗口与pinned sparse action源码，尚无本组未处理可证实finding；不代表完整PR审查或产品可合入。下一步需要光照调度因果验证，再运行新artifact唯一browser。

### Browser10 derived light 调度的判别合同

World.drainCommits原每render只调用一次真实cache.rebuildNearest；在慢帧与新的Authority halo到达时，正确dirty会持续积压。先用真实ChunkBlockLightCache与真实World.drainCommits建立无render推进的RED，不从“pending13”直接认定调度是唯一根因。候选只把derived light队列服务移至有界主线程timer；repository mesh drain与全部可见/postrender预算不变，flood/R8/revision/未知阻光/全部cache ready语义不变。每timer turn最多一次build/apply，复制最近实际camera position，有dirty才继续；以max(16ms,上次完整build/apply耗时×4)让出主线程，禁止零延迟积压循环或同时启动多个timer。dispose先取消timer再销毁sink/cache；已释放key/陈旧replacement沿原生命周期隔离。

定向测试区分调用者与pure helper：只调用一次实际World.drainCommits后、render不推进，真实dirty cache仍须完成；新的halo revision到来须重新计算，未完成不得ready；重复request不产生并发timer，取消后不得写sink，负camera输入拒绝。固定假时钟是调度功能证据，不冒充性能测量。若定向闭包通过，先同一唯一Classic spec按既有selectionArgs执行visual correctness subset（不宣称主旅程或性能GREEN），再新artifact完整验收。可观测耗时只诊断，不从Browser10跨source数据宣称FPS收益；若性能结论需要，另冻结同源A/A及交错A/B窗口。当前candidate尚未运行产品浏览器，原visual FAIL仍未关闭。

Browser10仍有803次prediction authority-resync，但次数不能区分late、capacity或target-out-of-order。下一browser之前仅增加按client生命周期隔离的只读已接收input-decision计数，记录decision与requiresResync，不改sequence/epoch/order/owner拒绝逻辑或包timing；只在失败attachment读出，无每帧扫描、逐包日志或玩家状态写入。用实际client消息router验证重复/旧sequence不计、不同client隔离、读取副本不可修改；计数不当输入延迟测量。新CI e3b8f938检出约1秒，五项静态/构建/headless全部PASS；Chromium主旅程两次start-card原10秒等待FAIL，visual首轮原20秒未ready、重试start-card FAIL。启动失败额外只读DOM alert/按钮disabled/label与card display，输出有界诊断到失败attachment及job log；保持所有启动等待与验收predicate，先取得状态证据再诊断，不任意提高timeout。测试hook的相同失败采集抽到evidence helper以保留500行边界。

### Derived light 当前 halo 身份与 readiness

新增判别反例：真实 cache 已完成一次构建后，reader 的 Authority halo revision 改变，且没有人为调用 invalidate/register。此时旧 volume 不得让 snapshot.ready 继续为 true；下一次 rebuildNearest 必须能发现并重建此变化。先取得该反例 RED，再决定修复。候选仅比较已注册 brick 的 27 个 halo 身份并标记 derived dirty，不读取全体 voxel、不修改 Authority 或 flood/R8 语义。已 dirty 的首次等待序号必须保留，避免重复扫描使公平性失效。此检查是正确性合同，不宣称帧率或整体性能改善。

### Browser12 主线程停顿期间的持续攻击

source1df46ae0/build11的visual-only为1/1 PASS、全缓存ready且worldRevision41/lightRevision41，12GLB呈现、页面/响应/渲染错误为空，截图检查可见封闭房间未照明与glowstone照明差异。完整Browser12终态2 FAIL/1 SKIP：C0-C2完成，C3连击buffer/第二步可见但第二步实际damage2、sequence3/comboStep1，原7点断言FAIL；未到V1/V2/C4/C5。该次失败frameMs961，receipt分类accepted1164/late367；不能由计数证明战斗原因。后续visual启动仅有loading card、无alert/buttons，原10秒FAIL；旧子集通过不覆盖该失败。

下一个判别RED必须同时停止render和主线程timer回调，让完整Classic registered Combat仍按独立Authority时钟推进：真实mousedown持续按住应通过正式攻击入口形成literal第一击5、第二击7且第二个sequence就是第二段，而非两次第一击后剩余2。当前主线程timer只证明render独立，未证明长主线程任务期间可玩。

若RED确认此边界，候选把持续指针意图交给现有Authority worker的串行hostOperation节奏服务；每200ms至多一个正式AuthorityAction.attack，不补积压、不改Combat窗口/伤害、权限、range/LOS、lifetime或位置owner。worker根据最近真实yaw/pitch与当前Authority实体/位置重新选目标；输入epoch/递增sequence、释放、失焦、解锁、隐藏、UI/暂停、模式/世界替换、dispose及有界失活lease必须停止，旧packet不得复活意图。首次mousedown仍立即执行，采掘elapsed沿原路径。该输入状态仅瞬态，不进入存档，不新增Classic硬编码或第二套Combat owner。先验证实际consumer和取消/新鲜性反例，再新artifact原完整browser。

Browser-local pointer envelope携带递增sequence、同次gesture、绝对monotonic采样时间与方向；不扩公开GameplayAction或存档协议。2秒lease过期/生命周期或模式变化会退休gesture，旧renew不得重启，必须新按下。结果按runtimeEpoch拒绝旧世界、 bounded64去重并允许当前窗口内重排commit一次交付；gameplay既有revision gate保留。必要的500行边界仅把既有request/transaction计数与post失败生命周期整体抽到request sender，行为与原client合同不变。

启动失败先追加只读boot阶段/时间诊断，区分scene/material/worker bootstrap与首chunk可见等待；不提高10秒、不改变加载成功或质量口径。新证据后才能选择产品修复，不能仅再跑同源码重试。

## 模型与预算

主力按用户指定 Sol/high/default；一个有界独占测试 fixture 子任务使用精确 Luna/medium，不再委派。禁止 ultra/Astra 开发。所有工作共享每周总额度40%上限，保守剩余约60%停止；本云工具没有真实周额度 UI 查询，依赖主对话提供读数（14:26 UTC剩余94%，包含同账户其他任务），不由 token/credit/API 金额换算百分比。收到停止即保存进度。

## Delivery Snapshot

实施中。新运行使用独立 ID。静态/构建不替代产品验收；旧 Browser25 不为本 head 背书。长期 docs baseline 暂不更新，待修复事实确定后记录理由。
