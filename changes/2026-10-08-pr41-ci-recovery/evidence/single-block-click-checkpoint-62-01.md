# 单次真实鼠标点击边界修复

基于HEAD8ea883a1ba0c7200252340257fe5c19a5e6e52fb的Browser61原始FAIL。visual原独立mouse.down/up：down方法142.235ms、方法结束后180.308ms才开始up；这是API调用区间，不是精确浏览器physical event时间。原beforeClick两块3，afterRelease两块0，worldRevision36→38。源码实际block consumer是PlayerMiningState的creative250/200ms重复节奏，WorkerPointerAttackInputPump负责entity attack，不混淆。

只把visual的一次点击复用既有clickCanvasCenter原生page.mouse.click；同一原生动作内释放后等待after-call响应，保留真实输入、PointerLock/virtual coordinates。失败时尝试mouse.up并保留原错误。不改正常长按、生产cadence、世界/authority owner、画质、超时、重试或断言。原first block Air、后块3、20 physics ticks及三个原始snapshot附件全部保持。

新增真实PlayerMiningState合同夹具及headless选择器：原分开down/up在固定322ms响应等待中的一帧发出第二次请求，RED实际EXIT1（1 FAIL）；候选native click先释放，两个用例PASS，包含release失败保留原错误/held清理、后续帧不复活。此端口夹具不是Authority/browser或性能证据。

修复后六个输入/攻击回归文件42/42 PASS，实际PTY EXIT0；完整pnpm verify:static:ci实际PTY EXIT0。私有原始日志：/workspace/pr41-recovery-20261008-root-01/single-block-click-red-62-01.log、single-block-click-regression-62-01.log、single-block-click-static-62-01.log。新identified build和唯一完整pr41-classic-browser62-01尚未执行；不能计产品PASS。完整本地headless未重复执行，前驱60为103文件663 PASS，新增两例已定向验证，远端新SHA检查待触发。

前驱精确8ea CI60 run37977335446自然终态：deterministic、production build、Classic headless、architecture、static均SUCCESS；Chromium主首轮15.3分钟、重试15.4分钟FAIL，堆栈为V2 prepareCraftedIronArmor→mineResources→followEquipmentRoute→walkTo，原900秒耗尽；Visual1.5分钟PASS，Modular SKIP、部署SKIP。该失败未被单击修复关闭。

传统0.2PD×120%=0.24PD，AI30min×120%=36min，19:34开始、20:10有界checkpoint；19:41实测周剩83%、约60%停止线保持，未估算PR专属周比例。长期docs baseline不改：沿用现有真实输入职责。正式transport/Modular/统一光照消费者、全旅程和组合性能仍是PR合入阻塞。
