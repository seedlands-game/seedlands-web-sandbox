# 鼠标锁释放事件保留发起原因

## 背景与目标

最终回归连续四次复现：按E打开背包后立刻Escape关闭，迟到的pointerlockchange看到背包已经关闭，错误弹出暂停菜单。实际事件trace：1380ms主动exitPointerLock，1386ms关闭背包，1395ms释放事件到达。瞬时UI状态不足以判断释放原因。

## 范围与明确不做

只记录生产主动释放鼠标锁的待消费原因，在对应事件到达时消费；浏览器Escape主动解锁、失焦自动暂停继续保留。不使用固定延时、防抖窗口，不跳过真实鼠标输入，不修改历史已交付用例。

## 决策

新增浏览器侧pointer-lock小模块，统一主动释放及事件归属；PlayerController释放时标记，ApplicationShell接收事件时先消费。记录上次观察到的锁状态，多个排队事件读到同一最终状态时只处理一次转换；新锁获取清除过期标记，退出世界后的迟到事件也会消费，不把原因带入新会话。

## 行为

Given 鼠标锁定，When E打开背包并在释放事件到来前关闭，Then 迟到事件不暂停世界。Given 玩家重新锁定并用浏览器Escape解锁，Then 正常暂停。Given 暂停、死亡或离开世界主动解锁，Then 不将迟到事件解释为新的玩家暂停意图。

## 测试设计

真实既有外壳用例连续四次RED；新的需求用例在10个隔离Context分别快速开闭，等真实pointerlockchange已到达后检查暂停仍隐藏，再独立验证手动Escape解锁暂停。用例先在原代码RED，再实现；不加入长期基线。

## 验收与证据

- [x] Playwright-change：快速背包开闭10次通过，真正Escape解锁正常暂停。
- [x] Playwright-change：外壳、高级光影和20次资源回收通过。
- [x] Static / Build：完整静态和构建。
- N/A：没有改变美术和音色，不新增审美验收。

## 任务与当前状态

Delivered：主动释放归属与观察到的锁状态共同控制暂停。

## 交付快照

首次修复仅消费一次主动标记仍失败：快速第二次开闭时，两个排队pointerlockchange均观察到unlocked。新增实际状态转换去重，未增加延时或放宽断言。

连续同页极速重锁触发Chrome在Escape后的鼠标锁冷却拒绝，并非暂停菜单复发。用例改为10个隔离Context重复同一快速打开/关闭竞态，真实Escape另项验证；仍等待释放事件，不增加sleep或减少重复次数。

最终 `SEEDLANDS_E2E_PORT=4241 pnpm exec playwright test changes/2026-09-05-pointer-release-ownership/e2e --repeat-each=10`：20项46.1秒通过。最终Shell/三档光影/20会话资源组合8项52.5秒通过。完整Static234 passed/4 skipped、world95.03%、Svelte0/0、Build通过；最后需求用例调整另经格式/ESLint/typecheck。修改路径为application-shell、player-controller和pointer-lock浏览器模块；没有世界规则或存档格式变化。
