# Local Commit Only Delivery

**Status:** Delivered locally

## Context & Goal

将 change 的默认交付边界收敛为当前 worktree 的明确功能分支与本地语义化 commit，避免每个完成 change 自动外发到 remote。

## Scope & Non-goals

- In scope: 更新项目交付规则，并解除当前 Macro Worldgen change 的自动推送待办。
- Non-goals: 删除或修改 remote、改写既有 Git 历史、推送任何分支，或改变测试/准出门槛。

## Decisions

**Direct implementation:** 提交是本地可恢复交付的一部分；推送是外部可见写入，必须由用户在当轮明确请求。若 worktree 处于 detached HEAD，提交前仅创建/切换 `codex/<change>` 功能分支，不移动既有分支。

## Behaviour

- Given 一个 change 已通过准出, When 创建交付提交, Then 仅暂存该 change 的文件，并在当前 worktree 的明确功能分支创建语义化本地 commit。
- Given 当前 worktree 是 detached HEAD, When 准备首次提交, Then 创建或切换到 `codex/<change>` 分支，不改写其他引用。
- Given 用户未在当轮明确要求推送, When change 完成, Then 不执行 `git push`，也不把 remote/upstream 缺失视为阻塞。
- Given 用户明确指定远端与分支并要求推送, When 本地 commit 存在, Then 再按该授权执行独立的外发操作。

## Acceptance & Evidence

- [x] `AGENTS.md` 明确 worktree 分支与本地 commit 的默认交付规则。
- [x] 默认自动 push 已移除，明确 push 需要当轮用户授权。
- [x] 当前 Macro Worldgen 交付记录不再把未推送视为阻塞。
- [x] `git diff --check` 通过。

## Tasks & Current State

1. [done] 审计现有交付规则与当前 Macro change 状态。
2. [done] 更新本地 commit-only 规则与 Macro delivery record。
3. [done] 仅提交本规则 change 的文件；不推送。

## Delivery Snapshot

Changed paths: `AGENTS.md`, this change record, and `changes/2026-09-03-macro-worldgen/spec.md`.

Validation: `git diff --check` passed.

Git: delivered as a local commit on `codex/macro-worldgen`; no remote push is part of this change.
