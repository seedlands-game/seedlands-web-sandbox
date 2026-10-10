# Media Web 公共消费链证据

状态：正式 stdlib Media wire 的 Web/Worker consumer、Pack media loader 和共享音频生命周期已完成定向 GREEN；等待 root 串行执行 production build、生成新 Pack artifact并做唯一浏览器验收。本文件不宣称当前旧 public artifact 或真实音频设备已验收。

## 实际 Consumer 矩阵

| 边界                   | 实现与行为                                                                                                                                                                                                                                                                                                                                                | 证据                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Worker committed facts | `AuthorityRuntime.takeMediaFacts(runtimeEpoch)` 返回按事务保留的 batch 数组；transaction response 先发布 gameplay projection，再逐 batch 发布 `authority-media-facts`；tick有 pending fact时强制同轮包含 gameplay view，再按原顺序发 facts。空 drain不 post，失败事务不 drain。                                                                           | `authority-media-publisher.test.ts`、`authority-worker-response-media.test.ts`                                  |
| Browser protocol       | 只从 `@seedlands/stdlib/server/protocol/authority-worker-protocol` 使用正式 batch/projection clone validator。外层 `message.epoch` 只走既有 worker session gate；`batch.worldEpoch` 只对当前 `runtimeEpochValue`。                                                                                                                                        | `browser-media-frontier.test.ts`、`browser-authority-client.test.ts`、`browser-authority-world-harness.test.ts` |
| 双游标与实例 identity  | projection revision 和 consumed fact revision 分开维护；key 为 `definitionId@x,y,z`。start/play fact 必须与完整当前projection的revision及结果状态一致；相等的对应事务首次fact仍触发，重复不重播，低/高revision及同revision错track均拒绝，同definition不同position独立。正式 `insert-and-activate` 作为单一start fact进入同一路径，Web不补发activate。     | 同上；`browser-media-audio-consumer.test.ts`覆盖正式frontier→runtime→audio一次启动、迟到fact和同位置重建        |
| 原子 epoch/批次安装    | ready/snapshot/response/restore 先整批 clone所有 media entry，再更新client state或回调。restore先验证，再切runtime epoch并清双游标；`onWorldEpochChanged`重建audio world后才发布新projection。坏restore保留旧epoch、projection和fact cursor。                                                                                                             | BrowserAuthority两套测试                                                                                        |
| 恢复                   | fresh client仅用 ready/restore projection中的slot+resource建立 `resumePending`；不重放fact、不依赖live fact缓存；合法gesture后从头播放。                                                                                                                                                                                                                  | `world-media-runtime.test.ts`                                                                                   |
| Audio                  | `WorldMediaAudioAdapter`复用唯一 `AudioMixer.context` 和 `music` GainNode，使用Web Audio decode/source；没有空间音频或第二图。pause停止source并保留intent；gesture恢复；ended/eject/switch/endWorld/dispose释放listener/source/node/lease。首次unlock前到达的projection/fact有界保留，合法手势创建共享runtime后恢复。                                     | adapter/player/runtime tests与`reference-audio-lifecycle.test.ts`                                               |
| 多设备/stale async     | 每个实例独立 `WorldMediaPlayer`；两台同型设备可并发播放。A的stop/eject只清A，B不受影响；完整projection移除实例立即dispose，不等待eject。旧fetch/decode、旧world及同epoch旧revision迟到结果不能复活；同位置重建仅接纳server high-water之后的新revision。                                                                                                   | player/runtime/frontier tests                                                                                   |
| 错误反馈               | resource/MIME/size/digest/decode/start失败进入可读 `GlobalAudio.snapshot().error/worldMedia.error`，并由Game通过既有 `UiWorldSession.publishFeedback`显示；不伪造Authority stop。                                                                                                                                                                         | player/runtime/reference lifecycle tests                                                                        |
| Pack resources         | 从完整verified `packs.lock` exact shape生成 `{packId,path,digest,url,size,contentType}` audio index；整批fact/projection的全部resource先同步验证，再触发任何audio callback。URL解析后校验same-origin和Pack目录，MP3仅接受显式音频类型，独立上限8MiB；流式读取有界并复核header/actual size和SHA-256。非音频元数据先验证再跳过，不放宽presentation loader。 | `pack-media-loader.test.ts`、`pack-loader.test.ts`、`game-media-controller.test.ts`                             |
| 旧上传退场             | 原参考曲surface无 `importReference`、`removeReference`、`referenceName`、audio file input或`chooseFile`；其他外观/JSON导入的File API不属于本任务且保留。内置合成music、shared context、四音量、普通SFX/ambience继续受回归覆盖。`reference-music`只剩实验性能面板复用的复合CSS class。                                                                     | `reference-audio-lifecycle.test.ts`与定向静态grep                                                               |

## RED / 修复记录

- Audio adapter首轮 RED：`world-media-audio-adapter.test.ts` 0 tests collected，缺少正式模块。新增共享 mixer adapter后 `2/2`。
- Pack loader并发测试最初暴露单一 pending controller会让第二设备取消第一设备；改为每个 resolve 独立 controller集合，仅 `abort/dispose` 统一失效。一次RED命令因测试 deferred在早期断言后悬空被人工终止，随后修正测试清理并纳入最终矩阵。
- 首轮完整矩阵：`11 files / 72 tests`，`1 failed / 71 passed`。唯一失败是Node不能动态import `blob:` URL；测试改用等价 `data:` ESM验证lock成功分支，生产实现未放宽。
- Web typecheck逐步捕获并修复 Pack lock unknown narrowing、GlobalAudio unused参数、组合类型和fixture类型；未使用 `any` 或关闭规则。
- targeted ESLint首轮发现 `Game`/`BrowserAuthorityClient`超过500有效行；新增媒体职责分别下沉至 `GameMediaController`、`BrowserMediaFrontier`，最终不禁用 `max-lines`。
- `GameMediaController` 对 ready 返回前可能到达的 committed batches做最多64批的有界启动缓冲；world runtime建立后仅按匹配 `worldEpoch` 的原顺序flush，restore/end清空旧world缓冲。
- 最终静态门禁捕获 `BrowserAuthorityClient` 与其测试因公共kind增量分别超过8/12有效行；只压缩既有简单getter并提取重复media batch fixture，未删断言。`GlobalAudio`另有unlock前projection/fact缓冲回归，确保首次尚无mixer时不丢权威媒体状态。
- MEDIA-WEB-CLOSE-01 有效 RED：合法 `authority-ready` 已安装同实例revision 3空槽停止projection，随后同session/同world收到revision 1 `insert-and-activate`；`browser-media-audio-consumer.test.ts` 失败为 `resources.resolve` 预期0次、实际1次，证明旧曲确实进入加载。修复后frontier、runtime与player共用当前projection状态匹配；unlock前缓存的历史start不会短暂发声，pending fetch也会在较新projection到达时失效并释放。
- 完整projection只保存当前实例的有界cursor；实例缺失禁止start/play且立即dispose，stop/eject可被frontier观察但runtime不创建player，不积累历史坐标tombstone。954已以真实Classic Authority回归证明同epoch同位置jukebox破坏后重建revision严格高于removal high-water；Web重建回归验证高revision可播放、旧revision随后迟到不复活。

## 最终验证

所有命令均独立通过默认 `benchmark-window` 全机锁；Vitest使用 `--maxWorkers=1`。

```zsh
MEDIA_TESTS=(
  apps/web/tests/unit/app/world-media-audio-adapter.test.ts
  apps/web/tests/unit/app/world-media-player.test.ts
  apps/web/tests/unit/app/world-media-runtime.test.ts
  apps/web/tests/unit/app/game-media-controller.test.ts
  apps/web/tests/unit/app/browser-media-audio-consumer.test.ts
  apps/web/tests/unit/app/reference-audio-lifecycle.test.ts
  apps/web/tests/unit/client/browser-media-frontier.test.ts
  apps/web/tests/unit/client/pack-media-loader.test.ts
  apps/web/tests/unit/client/pack-loader.test.ts
  apps/web/tests/unit/client/browser-authority-client.test.ts
  apps/web/tests/unit/client/browser-authority-world-harness.test.ts
  apps/web/tests/unit/worker/authority-media-publisher.test.ts
  apps/web/tests/unit/worker/authority-worker-response-media.test.ts
  apps/web/tests/unit/worker/authority-worker-ingress.test.ts
)
MEDIA_FILES=(
  apps/web/src/app/audio/game-media-controller.ts
  apps/web/src/app/audio/global-audio.ts
  apps/web/src/app/audio/music-player.ts
  apps/web/src/app/audio/world-media-audio-adapter.ts
  apps/web/src/app/audio/world-media-player.ts
  apps/web/src/app/audio/world-media-runtime.ts
  apps/web/src/app/bootstrap.ts
  apps/web/src/app/browser-worker-session.ts
  apps/web/src/app/game-runtime-controls.ts
  apps/web/src/app/game.ts
  apps/web/src/app/ui/shell-overlays.svelte
  apps/web/src/client/authority/browser-authority-client-contract.ts
  apps/web/src/client/authority/browser-authority-client.ts
  apps/web/src/client/authority/browser-media-frontier.ts
  apps/web/src/client/authority/media-playback-admission.ts
  apps/web/src/client/presentation/pack-media-loader.ts
  apps/web/src/worker/authority-media-publisher.ts
  apps/web/src/worker/authority-worker-ingress.ts
  apps/web/src/worker/authority-worker-response.ts
  apps/web/src/worker/authority-worker.ts
  apps/web/src/worker/pack-loader.ts
  "${MEDIA_TESTS[@]}"
)
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- \
  pnpm --filter @seedlands/web typecheck
# PASS: svelte-check 0 errors/0 warnings; Web tsconfig and tools tsconfig PASS
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- \
  pnpm exec vitest run --config apps/web/vitest.config.ts "${MEDIA_TESTS[@]}" --maxWorkers=1
# PASS: 14 files / 95 tests
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint "${MEDIA_FILES[@]}"
# PASS
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- \
  pnpm exec prettier --check "${MEDIA_FILES[@]}" \
  changes/2026-09-23-classic-functional-completion/media-web-public-evidence.md
# PASS
git diff --check -- "${MEDIA_FILES[@]}" \
  changes/2026-09-23-classic-functional-completion/media-web-public-evidence.md
# PASS
```

未运行：production build、browser/dev server、Playwright/Cua、全仓suite、CI、部署、Git写入。

## Artifact 与未验证项

- 静态读回时 `apps/web/public/packs/packs.lock.json` 仍是此前生成的旧artifact：resource只有`{path,sha256}`，且未包含`to-far-shores.mp3`；目标built media文件也不存在。新Worker/main-thread validator会fail closed。该目录必须由root最终build串行重建，不能手改生成物。
- 最终artifact需要验证MP3条目为`2976045` bytes、`audio/mpeg`和SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`，并验证同artifact真实浏览器gesture播放、pause、eject/break、restore、world switch与错误反馈。
- 本阶段没有修改赠送/loadout；唱片获取继续使用正式creative catalog/selection。没有恢复File/Blob上传或全局BGM替换。

## 冻结源码 SHA-256

```text
world-media-audio-adapter.ts       d5f0897d401fd3592bfa00ac1544bff11ee0df33957eebbc224de78f89f64d48
world-media-player.ts              16013aa54ea2f56591c95b2a4ed7d90777adac6e78e5391f9049d0b04d3d26f8
world-media-runtime.ts             575ad600dfe2f53fc5370e0118b9158cad5e1939b981040bf25b70bb2d87bd3b
game-media-controller.ts           8282f4ef1d3a6455536d698a85758e473d26f58b0d8397120f2a7e24d1e2d3c9
global-audio.ts                    73541150ba1f421776927e47778079df44a6ee55758893c4dc6ed336d452a6cc
music-player.ts                   7312b0c878c4817b5b87ef85e61b0c0c09c2f1bfb4c44606076d5be6a485f495
bootstrap.ts                       eec865ef67418c2850ee358f00e655034de60e7419b804365656cf58a5860306
game.ts                            dfc115076ba0bd767dd059fa5388bb1606b99fd12185e64a292e65da0250633f
game-runtime-controls.ts           6c8b061781d98661988bfdfa107dc222c35df3f42581b1a61ab5d2c67f3988f4
browser-worker-session.ts          c786950dacb88f2730d0189d7d0e067ffe90f8039edb34db1867ee6018c8541c
browser-media-frontier.ts          1f04687ce6ac3c3881b720bc21c975af8f2051265f24a6e7817ae555e73d41b3
media-playback-admission.ts        738845e024a73299fdc921d45517d4e50dd4073fe4d648344fc60402cac80c8d
shell-overlays.svelte              29801715524c6a4d329a2b4e12be715df83e070ab4fa6b8849086c2082106a15
browser-authority-client-contract.ts 83eccb4d80d25a7f7c5d17c5a61f7d65b1c3a8c242bb0af2cd8b893948944510
browser-authority-client.ts        951392202622b85acfd1c5676c6b1f5c952e0c7d77147f00f9a26608ab0dfadb
pack-media-loader.ts               47dbdcd6e819cc224edad73f050106be98b7cdc3dd92b618547625634f9b5267
authority-media-publisher.ts       a8a292819c4aa204c5e01a152bcc103b04c510cc2625900906c045f71d1e8d35
authority-worker-response.ts       9e60345112a3f0a149801df46832f2fbc5739089fe8a606942fe9f533e344286
authority-worker.ts                b6e3de057bd68563acc66798e2fc8729af871ce7bf6622b47d2381a85389394e
authority-worker-ingress.ts        56389b4db88da90164fbf04f94380d1ccc00ddaca1af8bca8e9869599fd441d4
pack-loader.ts                     1a6abac05ac2d350db2cc481bb6cdefdb6fd46df6ce0b1f6df1e44899e75f724
```

## 冻结定向测试 SHA-256

```text
browser-media-audio-consumer.test.ts      937f8d4b019fe672e44f6adfd79e6086e7951e30613fc25c4fad1014f8378490
game-media-controller.test.ts             efddfd60a5d5873bed6410fb30f4dd4504c4726fdd34f74be1a0bde99de13c12
reference-audio-lifecycle.test.ts         a93e5bab672012974cdd905b39655716ccb1d89a1b1524d8c01e717ae960a650
world-media-audio-adapter.test.ts         8d00f80f5ec25065f9e5617050891a061c8d9fe63b42ed07615f5b08c776f020
world-media-player.test.ts                7d0e00e89b8d11e4b59b2b6f07ef31772035d655dde2940ff3fa6015b93636e3
world-media-runtime.test.ts               68d78d201ed07e1f2a3ddd67be66969f3df4fd5c8e72494f3336f4bbf5bbeb27
browser-authority-client.test.ts          7075d197733bb036a0d3dd6228b49c178f0ad66193d8bad188e0135a7f7de483
browser-authority-world-harness.test.ts   20061bac30538c2d0f847b1eed0c91c27127c20cb2f39cfa13c4bac434f23241
browser-media-frontier.test.ts            b173fc8230f9d2fb1b5e5d46124ee351f8e55930028d095d9d79b1e5e4703763
pack-loader.test.ts                       8246736cdd0d275023ee1fa81d0b67cee68249bb6055d34c942bc89e8a193bb5
pack-media-loader.test.ts                 0af913784fb04a3b55d1761f68c2c7f67dcbbaf5a75c46d57b86a40e3ce54fd1
authority-media-publisher.test.ts         d49f43c0624e1168aa3b50f438e00ef33f6590fddb82909da25688cd6c664aaf
authority-worker-ingress.test.ts          620f146ae2ae6d98c1312cda726f595704263b030f8b9c88c58e4df01d6cb3fc
authority-worker-response-media.test.ts   0576f698c5c2ce668cc76f4d63d6d7ce08da6a0d028cafca3ba9caa28002993b
```

上述源码与测试哈希均在最终门禁后复算；evidence自身不纳入自指哈希。
