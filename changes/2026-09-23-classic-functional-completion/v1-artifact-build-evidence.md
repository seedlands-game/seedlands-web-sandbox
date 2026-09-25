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

## BUILD-06：流体来源目标闭包后成功

GIT-12 已提交并推送：代码与证据为
`19fadb27a5b1419025813bdbaceb0c0bb063cb63`，state 与远端冻结输入为
`0d19937123506d5e6b30af8ad9ebdf40aad28509`。root 已独立读回远端、PR 与 manifest；BUILD-06 不把
主工作树后写的 evidence/state 文档纳入构建输入。

从冻结 SHA 新建 `/private/tmp/seedlands-v1-acceptance-0d199371`。构建前 detached HEAD 精确为
`0d19937123506d5e6b30af8ad9ebdf40aad28509`，tracked diff/index 为空且 `apps/web/dist` 不存在。依赖视图
复制 BUILD-05 已验证布局：`node_modules` 与 `.pnpm-task-run-state-v1` 都是真实目录，第三方 `.pnpm` store
复用现有安装；根与 package 级 `@seedlands/kernel`、`@seedlands/stdlib`、
`@seedlands/playbook-classic` 均经 `pwd -P` 读回为该新树自身源码。构建前 identity 为：

```text
sourceSha=0d19937123506d5e6b30af8ad9ebdf40aad28509
sourceDigest=44a0e80f849cae44124228f464d6e7916801440aff2db6fd1cb84e95573cffb2
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

本阶段唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm build
```

结果：PASS。Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功；
Svelte 为 `0 errors / 0 warnings`。机器窗口 run
`f8557f4d-1bf9-4826-bb50-731e165f32ec`，`2026-09-25T02:20:10.008Z` 至
`2026-09-25T02:20:30.515Z`，exit `0`。本次按冻结的精确命令执行，没有 `tee`，因此完整 stdout 只保留在
当前任务工具输出，未伪造为原始日志文件；原始 window receipt 已逐字节归档。生成的 artifact 身份：

```text
sourceSha=0d19937123506d5e6b30af8ad9ebdf40aad28509
sourceDigest=44a0e80f849cae44124228f464d6e7916801440aff2db6fd1cb84e95573cffb2
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02
files=276
builtAt=2026-09-25T02:20:29.807Z
```

同一树、同一 dist 随后只运行一次：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:artifact
```

结果：PASS；机器窗口 run `c871ad1c-7b31-4cab-9b0f-c6aa7da49da6`，
`2026-09-25T02:20:59.183Z` 至 `2026-09-25T02:21:00.197Z`，exit `0`。全部 identity 字段、
`builtAt` 与 276 个盖章文件和 build 输出一致；磁盘共 277 个文件，另一个文件是 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`e41beefb89468632986960b4e7adcca5218a7e15eed63bd43937f274271a8637`。关键文件映射：

```text
06f3425eecd29446bc9f7c34ac6f3ddb6e6988c1f9342aafd91fddacda03e253  index.html
e261167d91956c0c2836263ba509d61ad081754210c9272eb9d40a7d1678df1e  assets/authority-worker-C3q3-MA_.js
611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45  assets/rust-kernels-scalar-hRRXiZem.wasm
c1a763778c4eb4873772cf480c758f8b18cbc77beee80c933dda6b2fd19e4b2c  assets/rust-kernels-simd-cUjVQL8I.wasm
863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b  packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  packs/playbooks/classic/assets/audio/to-far-shores.mp3
```

Pack lock 的媒体条目与 dist 文件再次核对为 path
`playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、contentType `audio/mpeg`、
SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-06 原始 receipt 已逐字节归档到 `evidence/v1-artifact-build-06/`：

```text
0058184d3c4ea49b801b499d07ee41e544358fbed23b366722aa37d4ed93909c  build-receipt.json.log
59e711d4b9ed0ae9fe70125cfea314143c549a8b3dc2cf151f9bc874e988346c  artifact-verify-receipt.json.log
e41beefb89468632986960b4e7adcca5218a7e15eed63bd43937f274271a8637  harness-artifact.json.log
```

验收树在 build 与 artifact 复验后仍为 frozen HEAD，tracked diff/index 为空；只读宿主进程检查无
benchmark、build、preview、Playwright、Chromium 或 dev server 残留。
`/private/tmp/seedlands-v1-acceptance-0d199371` 与同一 dist 保留给 root 后续唯一 browser owner 761；
`/private/tmp/seedlands-v1-acceptance-23069d71` 未清理。本阶段未运行 browser、Playwright、Cua、
dev server、CI/review 或部署。

## BUILD-07：路线模式 fixture 后成功

GIT-13 已提交并推送为 `5d52330fa58d315e9e10b1298e1bdc65e2321898`。该提交只修改 canonical
fixture 与当前 change 的合同、状态及 Browser-05/静态证据；生产源码未改。local、upstream 与
`git ls-remote origin` 均读回该 SHA，ahead/behind `0/0`。

从该 SHA 新建 `/private/tmp/seedlands-v1-acceptance-5d52330f`。构建前 detached HEAD 精确匹配，
tracked diff/index 为空且 `apps/web/dist` 不存在。`node_modules` 与 `.pnpm-task-run-state-v1` 均为真实
目录；第三方 `.pnpm` store 复用已有安装，根与 package 级 `@seedlands/kernel`、
`@seedlands/stdlib`、`@seedlands/playbook-classic` 均经 `pwd -P` 解析到 BUILD-07 新树源码。
构建前 identity：

```text
sourceSha=5d52330fa58d315e9e10b1298e1bdc65e2321898
sourceDigest=a0775d3e5cc3747f5bd34fea09b3a1c40dc117e41c88beb7117d1a72888fb7e9
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm build
```

结果：PASS。Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功；
Svelte 为 `0 errors / 0 warnings`。机器窗口 run
`f2ec7ec2-f6d3-4df3-ab7d-a965eb000026`，`2026-09-25T02:55:46.929Z` 至
`2026-09-25T02:56:07.451Z`，exit `0`。按冻结命令未使用 `tee`，完整 stdout 只保留在当前任务工具输出，
没有伪造原始日志文件；window receipt 已逐字节归档。生成的 artifact identity：

```text
sourceSha=5d52330fa58d315e9e10b1298e1bdc65e2321898
sourceDigest=a0775d3e5cc3747f5bd34fea09b3a1c40dc117e41c88beb7117d1a72888fb7e9
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02
files=276
builtAt=2026-09-25T02:56:06.631Z
```

artifact digest 与 BUILD-06 相同是因为 GIT-13 只改变测试和文档，生产 dist 字节未变；新的 sourceSha、
sourceDigest、builtAt 与 receipt 仍绑定 GIT-13 精确源码，未复用旧 receipt。随后对同一树、同一 dist
只运行一次：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm harness:artifact
```

结果：PASS；机器窗口 run `7e8575dc-d897-450b-8f5e-29b4aacf1e00`，
`2026-09-25T02:56:54.633Z` 至 `2026-09-25T02:56:55.746Z`，exit `0`。全部 identity、
`builtAt` 与 276 个盖章文件一致；磁盘共 277 个文件，另含 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`5f55da779eb0365b78dc67ac6c34c633f4e82143dbf3d065e340eb5a031a7756`。关键映射保持：

```text
06f3425eecd29446bc9f7c34ac6f3ddb6e6988c1f9342aafd91fddacda03e253  index.html
e261167d91956c0c2836263ba509d61ad081754210c9272eb9d40a7d1678df1e  assets/authority-worker-C3q3-MA_.js
611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45  assets/rust-kernels-scalar-hRRXiZem.wasm
c1a763778c4eb4873772cf480c758f8b18cbc77beee80c933dda6b2fd19e4b2c  assets/rust-kernels-simd-cUjVQL8I.wasm
863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b  packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  packs/playbooks/classic/assets/audio/to-far-shores.mp3
```

Pack lock 媒体条目与 dist 文件均为 path
`playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、contentType `audio/mpeg`、
SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-07 原始 receipt 已逐字节归档到 `evidence/v1-artifact-build-07/`：

```text
811327e67a522fcf8207e7c334e18b5671278648c2b0958925c987217b20441a  build-receipt.json.log
f3756709461bf8ddb6dc542171cba919bc9f997f8c9bb81586fad4a52668bef8  artifact-verify-receipt.json.log
5f55da779eb0365b78dc67ac6c34c633f4e82143dbf3d065e340eb5a031a7756  harness-artifact.json.log
```

验收树在 build 与 artifact 复验后仍 tracked/index clean，无 build、preview、Playwright、Chromium 或
benchmark 残留进程。`/private/tmp/seedlands-v1-acceptance-5d52330f` 与同一 dist 保留给 root 后续唯一
Browser-06；旧 `0d199371` 与 `23069d71` 树/dist 均保留。本阶段未运行 browser、Cua、dev server、
CI/review 或部署。

## BUILD-08：Structure 共享命中面后成功

GIT-14 已提交并推送为 `46b8173538f7e162f79c16fc92864139b3bc24a8`。从该精确 SHA 新建
`/private/tmp/seedlands-v1-acceptance-46b81735`；构建前 detached HEAD 匹配，tracked diff/index 为空且
`apps/web/dist` 不存在。`node_modules` 与 `.pnpm-task-run-state-v1` 为真实目录；根与 package 级
`@seedlands/*` 均经 `pwd -P` 解析到 BUILD-08 新树自身源码，第三方 `.pnpm` store 复用既有安装。
构建前 identity：

```text
sourceSha=46b8173538f7e162f79c16fc92864139b3bc24a8
sourceDigest=96532a3ecc82140d83d3d5c1b32c533d3f449d3c26269929295d8dfe7af717d9
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm build 2>&1 | tee /Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox/changes/2026-09-23-classic-functional-completion/evidence/v1-artifact-build-08/build.log'
```

结果：PASS。Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功；
Svelte 为 `0 errors / 0 warnings`。机器窗口 run
`ae91fc52-9f5e-4987-a1c6-468fc82ed249`，`2026-09-25T04:08:47.257Z` 至
`2026-09-25T04:09:08.543Z`，exit `0`。真实 stdout 已归档为 `build.log`。生成的 artifact identity：

```text
sourceSha=46b8173538f7e162f79c16fc92864139b3bc24a8
sourceDigest=96532a3ecc82140d83d3d5c1b32c533d3f449d3c26269929295d8dfe7af717d9
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e
files=276
builtAt=2026-09-25T04:09:07.618Z
```

同一树、同一 dist 随后只运行一次：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm harness:artifact 2>&1 | tee /Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox/changes/2026-09-23-classic-functional-completion/evidence/v1-artifact-build-08/artifact-verify.log'
```

结果：PASS；机器窗口 run `675c46e5-ec92-42f8-a337-e3d2e314e83a`，
`2026-09-25T04:09:54.453Z` 至 `2026-09-25T04:09:55.729Z`，exit `0`。全部 identity、
`builtAt` 与 276 个盖章文件一致；磁盘共 277 个文件，另含 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`78f2ce2396d8bc8314dd048d491e3b5dd4191f5a2d2ef04bd6c9aa752c253259`。关键映射：

```text
3119e6f83c15f30191b067a3ce05d2f2e974fa6401e9fbcb715a2037262f10dc  index.html
6f63394cb4d16293c319e0a88ba9ff2f0a928454af4cd752ffe0ac4ce5bfd26d  assets/authority-worker-R-urXYSz.js
611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45  assets/rust-kernels-scalar-hRRXiZem.wasm
c1a763778c4eb4873772cf480c758f8b18cbc77beee80c933dda6b2fd19e4b2c  assets/rust-kernels-simd-cUjVQL8I.wasm
863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b  packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  packs/playbooks/classic/assets/audio/to-far-shores.mp3
```

Pack lock 媒体条目与 dist 文件均为 path
`playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、contentType `audio/mpeg`、
SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-08 原始输出与 receipt 已归档到 `evidence/v1-artifact-build-08/`：

```text
c42cf2e2b2aa5bdafb3bb14d9aa29f90477c02c381e3c0d000b2f6ca1413e47e  build.log
57727757533873f13d9d6dc41696d8a3ac3b12f4e26a1dacc6a74b7346680bfc  build-receipt.json.log
9c0b675b539163702918882dc896432656e1b84675d98c3ac6f69b912fb90f96  artifact-verify.log
8af543131e8123792c9288c6ddb13c71ac499f3b75253007f318dc6a779399b3  artifact-verify-receipt.json.log
78f2ce2396d8bc8314dd048d491e3b5dd4191f5a2d2ef04bd6c9aa752c253259  harness-artifact.json.log
```

验收树在 build 与 artifact 复验后仍 tracked/index clean，无 build、preview、Playwright、Chromium 或
benchmark 残留进程。`/private/tmp/seedlands-v1-acceptance-46b81735` 与同一 dist 保留给 root 核验后交
761 唯一 Browser-07；旧 `5d52330f`、`0d199371` 与 `23069d71` 树/dist 均保留。本阶段未运行
browser、Cua、dev server、CI/review 或部署。

## BUILD-09：Fixture epoch 同域修正后成功

GIT-15 已提交并推送为 `06f42f5d0943c2f12a24264d9e5e607b22b33dee`。从该精确 SHA 新建
`/private/tmp/seedlands-v1-acceptance-06f42f5d`；构建前 detached HEAD 匹配，tracked diff/index 为空且
`apps/web/dist` 不存在。`node_modules` 与 `.pnpm-task-run-state-v1` 为真实目录；根与 package 级
`@seedlands/*` 均经 `pwd -P` 解析到 BUILD-09 新树自身源码，第三方 `.pnpm` store 复用既有安装。
构建前 identity：

```text
sourceSha=06f42f5d0943c2f12a24264d9e5e607b22b33dee
sourceDigest=607294f043101061d632e0b669b9aafe367c68ea6dc67d9dc1037f37cc94c245
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
```

唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm build 2>&1 | tee /Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox/changes/2026-09-23-classic-functional-completion/evidence/v1-artifact-build-09/build.log'
```

结果：PASS。Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功；
Svelte 为 `0 errors / 0 warnings`。机器窗口 run
`441c2a09-529f-4798-8fd7-4a1de8f2dec2`，`2026-09-25T04:59:33.904Z` 至
`2026-09-25T04:59:58.154Z`，exit `0`。真实 stdout 已归档为 `build.log`。生成的 artifact identity：

```text
sourceSha=06f42f5d0943c2f12a24264d9e5e607b22b33dee
sourceDigest=607294f043101061d632e0b669b9aafe367c68ea6dc67d9dc1037f37cc94c245
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e
files=276
builtAt=2026-09-25T04:59:57.103Z
```

artifact digest 与 BUILD-08 相同是因为 GIT-15 只改变测试和文档，生产 dist 字节未变；新的 sourceSha、
sourceDigest、builtAt 与 receipt 仍绑定 GIT-15 精确源码。随后对同一树、同一 dist 只运行一次：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- zsh -o pipefail -c 'pnpm harness:artifact 2>&1 | tee /Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox/changes/2026-09-23-classic-functional-completion/evidence/v1-artifact-build-09/artifact-verify.log'
```

结果：PASS；机器窗口 run `08c829e7-ca35-4e28-a305-92d206b106cb`，
`2026-09-25T05:00:47.168Z` 至 `2026-09-25T05:00:48.952Z`，exit `0`。全部 identity、
`builtAt` 与 276 个盖章文件一致；磁盘共 277 个文件，另含 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`6aa1a95de2f549dbf82186ca018a2bc1d272124e54269a11a99c00b33f4e9bd2`。关键映射与 BUILD-08 一致：

```text
3119e6f83c15f30191b067a3ce05d2f2e974fa6401e9fbcb715a2037262f10dc  index.html
6f63394cb4d16293c319e0a88ba9ff2f0a928454af4cd752ffe0ac4ce5bfd26d  assets/authority-worker-R-urXYSz.js
611c45804d9be51378388c8e7139620e2bbbeb089fe39cbf71792d712a9e7f45  assets/rust-kernels-scalar-hRRXiZem.wasm
c1a763778c4eb4873772cf480c758f8b18cbc77beee80c933dda6b2fd19e4b2c  assets/rust-kernels-simd-cUjVQL8I.wasm
863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b  packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  packs/playbooks/classic/assets/audio/to-far-shores.mp3
```

Pack lock 媒体条目与 dist 文件均为 path
`playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、contentType `audio/mpeg`、
SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-09 原始输出与 receipt 已归档到 `evidence/v1-artifact-build-09/`：

```text
7fa95203d326797124d30be0a8f905a1f8d2319e4268f0ec7fd3e1b299eede6a  build.log
f68a51f2c7c5342a9b133610988547ec499792265bfd7d24d9f987be6e4ee154  build-receipt.json.log
82e09a4b22398add16fbe04d26f63e4eb4b346bba7e125b5ff8f47b10383d752  artifact-verify.log
0c1b3542438d2caa7af0e9863f572b0f3fc51444c8b1292c0a97708e08f1bded  artifact-verify-receipt.json.log
6aa1a95de2f549dbf82186ca018a2bc1d272124e54269a11a99c00b33f4e9bd2  harness-artifact.json.log
```

验收树在 build 与 artifact 复验后仍 tracked/index clean，无 build、preview、Playwright、Chromium 或
benchmark 残留进程。`/private/tmp/seedlands-v1-acceptance-06f42f5d` 与同一 dist 保留给 root 核验后交
761 唯一 Browser-08；旧 `46b81735`、`5d52330f`、`0d199371` 与 `23069d71` 树/dist 均保留。本阶段
未运行 browser、Cua、dev server、CI/review 或部署。

## BUILD-10：真实鼠标瞄准 fixture 后成功

GIT-16 已提交并推送为 `244b18e311c2091ab4bd03082aa02deee1a9c09f`。从该精确远端 SHA 新建
`/private/tmp/seedlands-v1-acceptance-244b18e3`；构建前 detached HEAD 匹配，tracked diff/index 为空且
`apps/web/dist` 不存在。根与 Web workspace 的 `@seedlands/*` 均解析到新树自身源码；第三方
`.pnpm` store 复用既有安装，`.pnpm-task-run-state-v1` 为真实目录。

唯一 build 命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-244b18e3-build.log'
```

结果：PASS；Pack build、Rust artifact 验证、SSG、Web typecheck 与 Vite production build 全部成功，
Svelte 为 `0 errors / 0 warnings`。机器窗口 `80b06a2c-5466-438c-9be3-9fbf795e5ecf`，
`2026-09-25T05:49:27.143Z` 至 `05:49:48.501Z`，exit `0`。生成身份：

```text
sourceSha=244b18e311c2091ab4bd03082aa02deee1a9c09f
sourceDigest=78246a53f8f391e5aa4d1a4aeccc1318de26325909b96a544cb5a041eefe5f02
lockDigest=44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
artifactDigest=ea44e00745788392cd668daf67fe3b0eb2ca17bdef8f9804ad6275656891dd0e
files=276
builtAt=2026-09-25T05:49:47.329Z
```

artifact digest 与 BUILD-09 相同，因为 GIT-16 只改变 browser fixture 与证据；新的 source SHA、
source digest、builtAt 与 receipt 仍绑定 GIT-16。随后在同一树、同一 dist 只运行一次：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm harness:artifact 2>&1 | tee /private/tmp/seedlands-v1-acceptance-244b18e3-artifact.log'
```

结果：PASS；机器窗口 `f7480f0b-dab1-4bb9-9ae2-d5f875fd079a`，
`2026-09-25T05:49:55.071Z` 至 `05:49:56.516Z`，exit `0`。两次输出的 identity、
`builtAt` 与 276 个盖章文件一致；磁盘共 277 个文件，另含 receipt 自身。
`apps/web/dist/harness-artifact.json` SHA-256 为
`bcd6f60bba3091dfd40e5aad90d98224198c2037b4dfd5aae2ad4418938140a2`。

Pack lock SHA-256 为 `863ae8eb9606583240207741f8b0515e6c40234d209524493dc283ccf012a99b`。
媒体条目与 dist 文件均为 path `playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、
contentType `audio/mpeg`、SHA-256
`3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。

BUILD-10 原始输出与 receipt 已逐字节归档到 `evidence/v1-artifact-build-10/`：

```text
ebbffddb17e41a48ceea391f1f799bcc1cc171f39627df4cfd51bff5e1c452a9  build.log
a9b3d29f83dd895bd5a277d4e111ad5958131cfa30ed47a46eda9c8b3ab158f7  build-receipt.json.log
f8859210768fa4cdbc16a29b4f2893032effedcf7832aa2ab8ccaa5a0933e204  artifact-verify.log
f17fd3b643b4fa5d3ce85bbbfb7da2f0dd353cf7215f99889062bdac80f54076  artifact-verify-receipt.json.log
bcd6f60bba3091dfd40e5aad90d98224198c2037b4dfd5aae2ad4418938140a2  harness-artifact.json.log
```

验收树在 build 与 artifact 复验后仍 tracked/index clean，端口 4273 无监听。
`/private/tmp/seedlands-v1-acceptance-244b18e3` 与同一 dist 保留给 root 核验后交 761 唯一
Browser-09；旧 `06f42f5d`、`46b81735`、`5d52330f`、`0d199371` 与 `23069d71` 树/dist
均保留。本阶段未运行 browser、Cua、dev server、CI/review 或部署。
