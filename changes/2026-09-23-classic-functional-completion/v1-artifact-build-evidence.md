# V1 Production Artifact 构建证据

状态：`BLOCKED`。精确已推送源码的 production build 在真实 `ssg:check` 失败；未生成 `apps/web/dist/harness-artifact.json`，因此没有执行 `pnpm harness:artifact` 或浏览器。

## 源码与环境

- cwd：`/private/tmp/seedlands-v1-acceptance-edafd0c9`
- detached HEAD：`edafd0c9958d63b873e1818eca6732e072a732a8`
- 创建前目标路径不存在；创建后 tracked worktree 与 index 保持 clean。
- 本地、upstream 与 `git ls-remote origin refs/heads/feat/classic-beta173-playable` 在创建前均为同一 SHA。
- 未读取 `.env`/secret，未安装或升级工具，未修改全局配置。

依赖准备使用真实 `node_modules` 目录：第三方包逐项软链接到原工作区已有安装，根及 package 级 `@seedlands/kernel`、`@seedlands/stdlib`、`@seedlands/playbook-classic` 等 workspace 包明确链接到 detached 树自身源码。`realpath` 核验三处 `@seedlands/stdlib` 均为 `/private/tmp/seedlands-v1-acceptance-edafd0c9/packages/stdlib`。`node_modules` 被 source snapshot 排除，不改变源码身份。

构建前 `apps/web/dist` 不存在。`sourceIdentity()` 读回：

```json
{
  "sourceSha": "edafd0c9958d63b873e1818eca6732e072a732a8",
  "sourceDigest": "195cf42a27877728c3eeba13cf32078c9b293ec928e98fa11081f9862e665090",
  "lockDigest": "44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169"
}
```

## Attempt 1：依赖布局失败

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-edafd0c9-build.log'
```

结果：exit 1，未进入 `build:web` 实际构建。pnpm 拒绝软链接的 `node_modules/.pnpm-task-run-state-v1`：`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`。

- 日志已归档为 `evidence/v1-artifact-build-01/attempt-1.log`，933 bytes，SHA-256 `5af4463fccd8e8a086437e43448766829c732570f0ec99999ec0e5fdb82562f9`。
- benchmark receipt已逐字节归档为 `evidence/v1-artifact-build-01/attempt-1-receipt.json.log`，SHA-256 `ceb138da4bdb61b4476325da3861def0d18947c766309a6a85e2003f4b22da70`；`2026-09-24T20:45:59.097Z` 至 `20:46:02.016Z`，status FAIL，exit 1。`.json.log` 后缀防止格式化hook改写原始receipt。

授权范围允许修复一次已知本地依赖布局。确认无 dist 后，只删除上述临时树内状态软链接并创建同名真实目录；没有修改源码。

## Attempt 2：真实 Production 阻塞

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-edafd0c9-build-attempt2.log'
```

结果：exit 1。该次运行已经进入根 `pnpm build -> scripts/harness/artifact.mjs --build -> pnpm build:web`：

1. `pnpm packs:build` PASS，生成临时 Pack。
2. `pnpm wasm:rust:verify` PASS，输出 `Rust source/artifact fingerprints verified.`。
3. `pnpm ssg:check` FAIL：`apps/web/src/client/presentation/asset-catalog.ts:236` 抛出 `Missing builtin item material mapping: wooden-door`。
4. Web typecheck、Vite production build、artifact receipt 写入均未执行。

失败原因是已提交生产源码的 presentation catalog 闭包：`items` 包含 `wooden-door`，其 Classic 定义不走普通 `placesVoxel`，`nativeItemAssets` 没有对应模型，`itemMaterials` 又只声明 dirt/stone/wood/sand/berry/plank/glowstone/lantern，因此生成起始页加载完整 catalog 时 fail closed。这不是依赖布局、CI、浏览器或 MP3 错误；本阶段未获源码修复授权，未尝试第三次 build。

- 日志已归档为 `evidence/v1-artifact-build-01/attempt-2.log`，1909 bytes，SHA-256 `df7374f802934b08bdfe945e715077839696e0841d7e8f4d9ef2dcaf0aeadb64`。
- benchmark receipt已逐字节归档为 `evidence/v1-artifact-build-01/attempt-2-receipt.json.log`，SHA-256 `b97ec492d7495782423af360c19c5ff7b381f9e687234448f00abbf2017d892f`；`2026-09-24T20:46:46.266Z` 至 `20:46:49.717Z`，status FAIL，exit 1。`.json.log` 后缀防止格式化hook改写原始receipt。

## 部分 Pack 证据

Attempt 2 在失败前已生成 `apps/web/public/packs`，但它不是完整 production artifact。`packs.lock.json` 中的媒体条目与复制文件均匹配：

```text
path=playbooks/classic/assets/audio/to-far-shores.mp3
size=2976045
contentType=audio/mpeg
sha256=3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9
```

Pack 文件摘要：

```text
7259ae5ae2a3ba7ace583ec04b20e4ab27f784556156b491195cd53bfa2cd735  apps/web/public/packs/host-admissions.json
14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3  apps/web/public/packs/overworld.manifest.json
9539898fa836a80116774ffaed01345e08ab775ccb9930154557f596e4c824ea  apps/web/public/packs/overworld.mjs
954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5  apps/web/public/packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  apps/web/public/packs/playbooks/classic/assets/audio/to-far-shores.mp3
a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b  apps/web/public/packs/playbooks/classic/presentation.json
```

## 保留状态与下一步

- `/private/tmp/seedlands-v1-acceptance-edafd0c9` 已在两份日志与两份receipt逐字节归档到本change的 `evidence/v1-artifact-build-01/` 后精确清理；未执行全局worktree prune。
- `apps/web/dist` 不存在，`harness-artifact.json` 不存在；所以 `pnpm harness:artifact` 没有合法输入，本阶段未运行。
- detached 树 tracked diff 和 index 均为空；只有被 gitignore 排除的依赖视图与部分 `apps/web/public/packs` 产物。原工作区 Lighting/transport/保护 dirty 没有进入该树。
- root已准出`V1-ASSET-DOOR-CLOSE-01`：显式复用现有door utility sprite注册native pixel model，不恢复`placesVoxel`、不加通用fallback。修复提交后从新远端SHA新建干净build树再运行一次build；不能在当前已失败源码树上手改后冒充`edafd0c9` artifact。

## BUILD-02：新 SHA 成功

门物品表现修复经 GIT-08 提交并推送为 `60843904909b2439725a40bc1d4e725de8fcda18`。local、upstream与`git ls-remote origin`一致，ahead/behind `0/0`、index空。

从该远端SHA创建唯一验收树 `/private/tmp/seedlands-v1-acceptance-60843904`。依赖视图从一开始使用真实 `node_modules/.pnpm-task-run-state-v1`目录；第三方包复用当前安装，根与package级`@seedlands/*`均指向detached树自身源码。构建前tracked/index clean且`apps/web/dist`不存在。构建前身份为：

```text
sourceSha=60843904909b2439725a40bc1d4e725de8fcda18
sourceDigest=74b1bd156280a9253f4d1eafffff5d283be09171fb1a85156a1545d17c2e9361
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

本阶段唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-60843904-build.log'
```

结果：PASS。Pack build、Rust artifact验证、SSG、Web typecheck和Vite production build均成功；Svelte为`0 errors / 0 warnings`。生成的receipt为：

```text
sourceSha=60843904909b2439725a40bc1d4e725de8fcda18
sourceDigest=74b1bd156280a9253f4d1eafffff5d283be09171fb1a85156a1545d17c2e9361
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=3700a6551d1d359a099bfd757b1820ba84f891233d00a53c029b75bef5b30e5c
files=276
builtAt=2026-09-24T21:18:04.666Z
```

随后在同一树、同一dist运行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm harness:artifact 2>&1 | tee /private/tmp/seedlands-v1-acceptance-60843904-artifact.log'
```

结果：PASS，所有身份字段、276文件数与builtAt和build输出完全一致。`apps/web/dist/harness-artifact.json` SHA-256为`79f9cce2743a66f2598076540a88b351165fa7e8a085fe33952a274405839656`。

receipt文件映射包含：

```text
fc62e3458c90c5a4407fb96c59239ca4c34b583ab4f7e1535d908af25dc7c548  index.html
82d6da48fc0f779e91ee6d1bdacd4e902ffe2acecdce6afc27c10b7b283c7e23  assets/authority-worker-CCDFEzBy.js
611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45  assets/rust-kernels-scalar-hRRXiZem.wasm
c1a763778c4eb4873772cf480c758f8b18cbc77beee80c933dda6b2fd19e4b2c  assets/rust-kernels-simd-cUjVQL8I.wasm
954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5  packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  packs/playbooks/classic/assets/audio/to-far-shores.mp3
```

Pack lock媒体条目和dist文件均为path `playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、contentType `audio/mpeg`、SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-02原始证据已逐字节归档到`evidence/v1-artifact-build-02/`：

```text
ec559eb282e3ece179f83d966c02078832dbcabc2b8b828d8e32e8c809398d58  build.log
1b243ed7afcc2a5520dc40ffb372af6c806583a4969401b92bf4b0e3383fac65  build-receipt.json.log
ac2a3d505e0051ef14a07e675c1eacc44367e98cb2bd0dccd8ffa599e0ed85b3  artifact-verify.log
d694836b1933793f1f2fc81bd48903887c2e2c6ace1e949c434eefdc7937fecc  artifact-verify-receipt.json.log
```

验收树在build后仍tracked/index clean，无常驻build/dev/browser/benchmark进程；`/private/tmp/seedlands-v1-acceptance-60843904`和同一dist保留给root后续唯一browser租约。本阶段未运行browser/dev server/CI。

## BUILD-03：Presentation Lock 修复后成功

`V1-PRESENTATION-LOCK-CLOSE-01` 经 GIT-09 提交并推送为 `a77f1f4e9fef107582a4d4b576889e3083b5893f`。该提交同时归档 browser attempt 1 的原始结果；两份带尾随空格的原始错误上下文使用 deterministic gzip 保存，解压内容 SHA 保持不变。

从该远端 SHA 新建 `/private/tmp/seedlands-v1-acceptance-a77f1f4e`。依赖视图沿用 BUILD-02 验证方式，`node_modules/.pnpm-task-run-state-v1` 从一开始为真实目录，所有根/package级 `@seedlands/*` 指向新树自身源码。构建前 tracked/index clean、dist 不存在；源码身份：

```text
sourceSha=a77f1f4e9fef107582a4d4b576889e3083b5893f
sourceDigest=71d48e4324a657932bc56ffd797841d4aa267d8561952e40fc87fba2307ef900
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

本阶段唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-a77f1f4e-build.log'
```

结果：PASS。Pack build、Rust artifact验证、SSG、Web typecheck与Vite production build全部成功；Svelte为`0 errors / 0 warnings`。生成的artifact身份：

```text
sourceSha=a77f1f4e9fef107582a4d4b576889e3083b5893f
sourceDigest=71d48e4324a657932bc56ffd797841d4aa267d8561952e40fc87fba2307ef900
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=b984a1c6c8ea700d753ea97f93f96ac85a93b0cbf9aad25d3f8b0bcad32b2487
files=276
builtAt=2026-09-24T21:57:43.971Z
```

同一树、同一dist随后运行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm harness:artifact 2>&1 | tee /private/tmp/seedlands-v1-acceptance-a77f1f4e-artifact.log'
```

结果：PASS，全部身份字段、builtAt和276文件数与build输出一致。`apps/web/dist/harness-artifact.json` SHA-256为`f35872ae48e3934c37310bdbe3bd67902c1c4b8df0cf2ce5e19bd5b75dd4f890`。关键receipt映射：

```text
dd889fdaedc1f24cd3625c3597229d4246414319ce8075d1e19892d7c512bed2  index.html
82d6da48fc0f779e91ee6d1bdacd4e902ffe2acecdce6afc27c10b7b283c7e23  assets/authority-worker-CCDFEzBy.js
611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45  assets/rust-kernels-scalar-hRRXiZem.wasm
c1a763778c4eb4873772cf480c758f8b18cbc77beee80c933dda6b2fd19e4b2c  assets/rust-kernels-simd-cUjVQL8I.wasm
954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5  packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  packs/playbooks/classic/assets/audio/to-far-shores.mp3
```

Pack lock与dist音频文件再次核对为path `playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、contentType `audio/mpeg`、SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-03原始证据逐字节归档到`evidence/v1-artifact-build-03/`：

```text
fd27e60736f050665a4e2bbda0350992d992cab30db25c515c7b8104512f10db  build.log
b30248f95e55a77c8a3029f00031037acf56e7a752d73d69ef99846885193312  build-receipt.json.log
af5b40d215a802146bf8cfb3b378f0862526b1949cb45f2ca096d9d142864e62  artifact-verify.log
18e083fc769346fcc948683a081746583349ba759dd7f8fb1ace1e7996f3074e  artifact-verify-receipt.json.log
```

新验收树在build后仍tracked/index clean，无常驻build/dev/browser/benchmark进程。`/private/tmp/seedlands-v1-acceptance-a77f1f4e`与同一dist保留给root后续唯一browser租约；已确认browser01原始证据进入GIT-09后，旧`/private/tmp/seedlands-v1-acceptance-60843904`已精确清理。本阶段未运行browser/dev server/CI。

## BUILD-04：产品宿主 Structure 准入后成功

`V1-HOST-STRUCTURE-ADMISSION-01` 经 GIT-10 提交并推送为
`8ae1f514fa6e025ed31c4ab54ccf1c0960b8c586`。GIT-10 的 detached staged tree 通过产品
admission `3 files / 8 tests`、root test typecheck、目标 ESLint/Prettier、完整 staged diff check 和
自然 hooks；local、upstream、`ls-remote` 均为该 SHA，ahead/behind `0/0`，index 为空。

从该远端 SHA 新建 `/private/tmp/seedlands-v1-acceptance-8ae1f514`。依赖视图复制 BUILD-03
已验证布局，`node_modules/.pnpm-task-run-state-v1` 从一开始为真实目录；根与 package 级
`@seedlands/*` 相对链接均解析到新树自身源码。构建前 tracked/index clean、dist 不存在；源码身份：

```text
sourceSha=8ae1f514fa6e025ed31c4ab54ccf1c0960b8c586
sourceDigest=fe543a6491a31286d4a187ab172915070ef82aafe870274d7896f7a8eee4252a
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

本阶段唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-8ae1f514-build.log'
```

结果：PASS。Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功；
Svelte 为 `0 errors / 0 warnings`。机器窗口 run
`36765e9a-967f-417d-8193-382f01c52f95`，`2026-09-24T22:19:12.560Z` 至
`2026-09-24T22:19:32.316Z`，exit `0`。生成的 artifact 身份：

```text
sourceSha=8ae1f514fa6e025ed31c4ab54ccf1c0960b8c586
sourceDigest=fe543a6491a31286d4a187ab172915070ef82aafe870274d7896f7a8eee4252a
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=f278d8a1f51a31ff3c5620adfe2d46ab80340351d43dfc1ecd0033c218aa0224
files=276
builtAt=2026-09-24T22:19:31.799Z
```

同一树、同一 dist 随后运行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm harness:artifact 2>&1 | tee /private/tmp/seedlands-v1-acceptance-8ae1f514-artifact.log'
```

结果：PASS；机器窗口 run `6fa687ba-c70c-430a-893b-06f71da79ade`，
`2026-09-24T22:19:48.756Z` 至 `2026-09-24T22:19:49.577Z`，exit `0`。全部身份字段、
builtAt 与 276 个被盖章文件一致；磁盘共 277 文件是因为另含 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`636b046961e2bbf8be37ae48ede9e9b2501c8d8b4d5d8274842f80ef3045ed28`。

Pack 与产品 admission 核对：

- `packs/host-admissions.json` SHA-256
  `206b730961e79b3cda78acdd86d7616ab82194001e6c9f6b8462011397cf71d9`；Structure grant 精确为
  `read,execute`，不含 `write`。
- `packs/overworld.manifest.json` SHA-256
  `14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3`；正式模块权限请求
  34 条，与 host admission 差分 `missing=[]`。
- `packs/packs.lock.json` SHA-256
  `954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5`。
- MP3 路径 `playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、
  contentType `audio/mpeg`、SHA-256
  `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9` 均匹配。

BUILD-04 原始证据逐字节归档到 `evidence/v1-artifact-build-04/`：

```text
7ae650bee4ed48953ac7771efb1874cd093e1c1aba8959eea1da5e7268799b8e  build.log
8283fbbfc4217a266743bf143269422f29c15c529d86fb15bf7bd1183e824b36  build-receipt.json.log
2de50e9023d83d8c41ef8a0f39f4aa8efb1738d0ffc75f1b7acdf91bac71914b  artifact-verify.log
83f396747b723b6ec82b540170ec47e98abc4d0e6ff629b8e181c5a5d8826cb5  artifact-verify-receipt.json.log
```

验收树在 build 后仍 tracked/index clean，无常驻 build/dev/browser/benchmark 进程。
`/private/tmp/seedlands-v1-acceptance-8ae1f514` 与同一 dist 保留给 root 后续唯一 browser lease；Browser-02
原始证据已进入远端 GIT-10 且 BUILD-04 成功后，旧
`/private/tmp/seedlands-v1-acceptance-a77f1f4e` 已精确清理。本阶段未运行 browser、dev server、Cua 或 CI。

## BUILD-05：可信 Item Interaction Origin 后成功

`V1-ITEM-INTERACTION-ORIGIN-01` 经 GIT-11 提交并推送为
`23069d710086597964e0976dd6228ca4f7b1bb79`。GIT-11 的 detached staged tree 通过 stdlib
`1 file / 8 tests`、Web 正式 spine/Classic action/fluid `3 files / 22 tests`、stdlib/root-test/
classic-test types、含 `block-host-commit.ts` 的目标 ESLint、Prettier、目标 diff check 与自然 hooks。
local、upstream、`ls-remote` 均为该 SHA，ahead/behind `0/0`，index 为空。

从该远端 SHA 新建 `/private/tmp/seedlands-v1-acceptance-23069d71`。依赖视图复制 BUILD-04
已验证布局，`node_modules/.pnpm-task-run-state-v1` 从一开始为真实目录；根与 package 级
`@seedlands/*` 相对链接均解析到新树自身源码。构建前 tracked/index clean、dist 不存在；源码身份：

```text
sourceSha=23069d710086597964e0976dd6228ca4f7b1bb79
sourceDigest=cd99170c385292b10490b2a56e58690ff58ecf7c3923d36b52aa3119d5b2515f
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

本阶段唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-23069d71-build.log'
```

结果：PASS。Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功；
Svelte 为 `0 errors / 0 warnings`。机器窗口 run
`b6a0fca2-b600-4380-9365-7f07be320d4f`，`2026-09-24T23:01:47.398Z` 至
`2026-09-24T23:02:07.271Z`，exit `0`。生成的 artifact 身份：

```text
sourceSha=23069d710086597964e0976dd6228ca4f7b1bb79
sourceDigest=cd99170c385292b10490b2a56e58690ff58ecf7c3923d36b52aa3119d5b2515f
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=1df45ffb2a7a95b4cd02375b6b1e92a3fe92d701636f19fecd01e15127df918e
files=276
builtAt=2026-09-24T23:02:06.658Z
```

同一树、同一 dist 随后运行：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm harness:artifact 2>&1 | tee /private/tmp/seedlands-v1-acceptance-23069d71-artifact.log'
```

结果：PASS；机器窗口 run `c6bdef7a-bdfc-4492-a3f1-e1a970773913`，
`2026-09-24T23:02:23.652Z` 至 `2026-09-24T23:02:24.568Z`，exit `0`。全部身份字段、
builtAt 与 276 个被盖章文件一致；磁盘共 277 文件是因为另含 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`9fd52ead183af6487030fb24b6f522a84e45e46d08a335cad88f94b2aa00a1b8`。

Pack 与产品 admission 核对：

- `packs/host-admissions.json` SHA-256
  `206b730961e79b3cda78acdd86d7616ab82194001e6c9f6b8462011397cf71d9`；Structure grant 精确为
  `read,execute`，不含 `write`。
- `packs/overworld.manifest.json` SHA-256
  `14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3`；正式模块权限请求
  34 条，与 host admission 差分 `missing=[]`。
- `packs/packs.lock.json` SHA-256
  `954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5`。
- MP3 路径 `playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、
  contentType `audio/mpeg`、SHA-256
  `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9` 均匹配。

BUILD-05 原始证据逐字节归档到 `evidence/v1-artifact-build-05/`：

```text
d4cacad4c2b01bddd6f9d11121cf1b1ffec5b911bb69b196aba611e4c9acc335  build.log
b99ddce2daf3e39da411b8b718350a595f1ac78668c13ee11fe2ce9473078973  build-receipt.json.log
f7203789d83e00804505448a126664b99550f1e8f846a35b910e9d7b61cbf9df  artifact-verify.log
2d9444d01d0734dca8f2a617c0d9c312f3a2a2bd975d8c914beaee305a291feb  artifact-verify-receipt.json.log
```

验收树在 build 后仍 tracked/index clean，无常驻 build/dev/browser/benchmark 进程。
`/private/tmp/seedlands-v1-acceptance-23069d71` 与同一 dist 保留给 root 后续唯一 browser lease；Browser-03
原始证据已进入远端 GIT-11 且 BUILD-05 成功后，旧
`/private/tmp/seedlands-v1-acceptance-8ae1f514` 已精确清理。本阶段未运行 browser、dev server、Cua 或 CI。
