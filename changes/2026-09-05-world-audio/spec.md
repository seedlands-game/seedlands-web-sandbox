# 世界音频、电子合成与稀疏音乐

**状态：Active；父 goal 授权自主 SDD。**

## 背景与目标

目前浏览器世界无正式声音。根据已确认的 Sparse Electronic Fantasy Ambient 方向，让菜单、玩家操作、环境与世界事件拥有统一且真实可听的反馈；音乐有完整短曲、留白与场景变化，并允许用户从本机导入参考曲，无需外部服务即可游玩。

## 范围与明确不做

- GlobalAudio：用户手势解锁、Master/Music/SFX/Ambience 总线、菜单 UI 音、音量设置及应用级生命周期。
- WorldAudio：材质脚步、采集、放置、拾取、食用、伤害、实体音，风/水环境、低频场景上下文、稀疏 BGM Cue 和世界会话清理。
- 三组原创音乐：日间原野、林水、夜间；每组有 90–120 秒完整结构，采用温暖 Pad、柔和玻璃 Bell/Pluck 和长留白；支持同一 Cue 的基础/点缀分层。
- 原创程序化 SFX，以有限样本/电子合成生成并缓存；参考曲以用户 File 本地导入，支持切回内置音乐与移除引用，不上传。
- 真实浏览器录音、自动音频图/波形检查、试听与遥测；不将浏览器画面断言当作听觉证据。
- 不做最终商业 OST、在线音乐生成平台、AudioWorklet、自定义复杂 DSP、语音/模型、网络音频同步、任意插件链或音乐编辑器。

## 关键决策

1. Web Audio 做混音与合成底座；PlayCanvas SoundManager / SoundInstance3d 负责空间播放与姿态；Tone.js 负责原创音乐的乐音/音色/精确排程。共享 GlobalAudio 的 AudioContext，WorldSession 销毁不能关闭全局菜单音频。
2. 纯 `src/client/audio/` 合同负责 Cue 选择、音量验证、声音预算、事件去重、步距与音符编排。DOM/PlayCanvas/Tone 适配位于 `src/app/audio/`，不依赖 server 的可变对象。
3. 成功的权威 gameplay 结果触发完成音；被拒绝的动作只有可选错误提示。脚步来自实际水平位移且落地，不能根据按住 W 发声。大批量编辑聚合为受限 cue，不逐 voxel 播放。
4. 环境上下文最多 2Hz 更新，listener 姿态每帧更新；不为声音扫描整个世界。环境声源最多 4 个、短 SFX 同时最多 16 个；同一语义/目标 80ms 内去重，远处/超预算声音可拒绝且计数。
5. BGM 单 Cue 播放，有 45–120 秒静默间隔，入世界首次等待约 8 秒；当前 Cue 可自然结束，环境改变持续 8 秒后才切换，切换/暂停淡变不突断。危险只增加有限张力或压低音乐，不连续触发短曲。
6. 应用设置保存在版本化 localStorage；损坏值回退默认，所有增益夹在 0–1。默认 Master 0.65、Music 0.28、SFX 0.7、Ambience 0.32；最终试听可在合同内校准不破坏边界。
7. 参考曲输入限制单文件 30 MiB、解码时长最多 10 分钟；同一时间只保留一个本地参考曲。加载失败保留当前可用曲，不阻塞玩法。导入只存在本次应用会话，设置提示刷新需重选文件；不向存档塞媒体字节。
8. 暂停/后台不积压事件，恢复时从当前上下文续播或重新排程；离开世界立即拒绝旧 token 的事件并释放全部 world 音源。Master=0 不暂停世界逻辑。

技术核对：Tone.js 官方 `setContext` 接受已有 AudioContext；PlayCanvas 2.21.4 的 `Sound` 接受 AudioBuffer，`SoundInstance3d` 有公开位置、距离、播放与外部 AudioNode 接口。实际适配先在浏览器验证，再声称共享 context 成立。

## 行为

- Given 未解锁的页面，When 非用户事件请求声音，Then 不发声、不抛未处理异常；用户首次点击可解锁后续声音。
- Given 有效世界会话，When 行走/采集/放置/拾取/受伤，Then 材质与语义对应的声音可听；重复事件、远处事件与失败操作不会爆发大量成功音。
- Given 空中移动或站立不动，When 位置/按键更新，Then 不播放脚步；地面走相同距离时不同帧率的步数一致。
- Given 日间、林水、夜间上下文，When 达到 Cue 触发或缓变条件，Then 选择对应原创音乐，Cue 间有留白，Music 静音不消除 SFX。
- Given 本机音频文件，When 从设置导入并播放，Then 声音经 Music 总线且可移除切回内置，不发起上传；错误文件有可读反馈。
- Given 离开/重建世界，When 旧异步音频解码或事件完成，Then 不进入新世界；旧源、排程和引用被回收。

## 测试设计

- `tests/client/audio-policy.test.ts` 预期 RED：新模块不存在；覆盖音量损坏/钳制、预算释放与优先级、去重/会话、实际步距/落地、Cue 的上下文滞后/留白/暂停。
- `tests/client/audio-composition.test.ts` 预期 RED：新模块不存在；覆盖三首乐谱确定性、时长/音域/事件预算/分层、不同 seed 有受控 variation，以及 SFX 波形有限值/无削顶/首尾平滑/材质差异。
- `changes/2026-09-05-world-audio/e2e/world-audio.spec.ts`：实际用户手势解锁、同 AudioContext、总线音量、导入错误/移除、短声预算、世界进出释放、AudioBuffer 合成输出与浏览器录音非静音。依赖游戏外壳设置后完成集成。
- 原创 Cue 与代表性 SFX 输出离线试听样本；浏览器录音验证生产链路。Manual supplement 记录听觉留白、接缝、空间方位与混音层次；没有实际试听时保持该项未完成。
- UI 可见性/状态用 Midscene，并在总体旅程中覆盖；它不证明“好听”。

## 验收与证据

- [ ] **Vitest：** 音量、预算、去重、步距、Cue 编排与状态机通过。
- [ ] **Vitest / Playwright-change：** 三首完整内置 Cue 与各类程序 SFX 非静音、无非有限波形/明显数字削顶，排程与预算有界。
- [ ] **Playwright-change：** 用户手势、暂停/后台、主总线、参考文件、会话隔离和资源清理通过。
- [ ] **Playwright-change / Manual supplement：** 生产链路录音与实际试听覆盖音乐、材质/空间/操作/环境，符合克制且统一的电子奇幻方向。
- [ ] **Midscene：** 音量和参考曲设置可理解，导入/移除/错误反馈清楚。
- [ ] **Static / Build / Playwright-baseline：** 静态、构建、现有核心回归通过，记录 bundle/缓存/声源成本。

## 任务与当前状态

1. [已完成] 核对历史方向、当前依赖与公开 Audio API，建立本合同。
2. [已完成] 04:40 两个模块缺失 RED，04:42:58 两文件 8 项纯逻辑 GREEN。
3. [已完成] 共享 Audio graph、Tone 15.1.22、PlayCanvas 空间适配与 WorldSession 初步接入。
4. [进行中] Settings/参考曲/观测与生产录音浏览器用例已通过；权威生存事件集成、完整试听与交付仍待完成。

## 交付快照

当前未交付。05:00 Static/Build 通过；音频需求浏览器用例通过（12.7 秒），确认 sharedContext、非静音且未削顶的生产录音、无效/有效本地参考文件及移除、退出会话归零。此证据不等同完整听觉审美验收。加入 Tone 后生产入口 JS 2,336.55 kB / gzip 617.35 kB（较此前增加约 261 kB / gzip 69 kB）；框体资产独立缓存。技术来源：[Tone setContext](https://tonejs.github.io/docs/15.0.4/functions/setContext.html)、[PlayCanvas SoundInstance3d](https://api.playcanvas.com/engine/classes/SoundInstance3d.html)。

### 异步参考曲生命周期补充

整合复查发现：慢速解码成功后，MusicPlayer 会主动 stop 当前音乐；若期间已经切世界，就可能停止新世界音乐。新增可执行预期：参考曲是应用级本地选择，解码可更新全局引用，但不能自动停止/播放另一个世界的声音；较早导入和移除后的旧解码不能覆盖新选择。`tests/app/reference-audio-lifecycle.test.ts` 先 RED 再修复。GlobalAudio 只在同一次导入仍有效且世界 session 未变化时开始预览。

06:02 异步导入隔离3项通过：旧解码不能 stop 当前音乐、最新选择优先、移除后不能复活引用、跨世界只保留全局选择但不自动开始预览。该修复在06:03完整静态/构建中通过，后续仍需真实浏览器导入路径最终回归。
