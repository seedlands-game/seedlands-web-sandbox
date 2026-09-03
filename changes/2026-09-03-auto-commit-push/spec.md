# Automate Change Commit and Push

**Status:** Delivered locally; push blocked

## Context & Goal

让每个完成并通过准出的 change 自动形成可恢复的 Git 提交，并在已有 upstream 时自动推送，避免交付记录与版本历史脱节。

## Scope & Non-goals

- In scope: 仓库级自动 commit/push 规则及当前已完成 changes 的本地提交。
- Non-goals: 自行创建 GitHub 仓库、添加远端、强推、改写已发布历史或创建 MR。

## Decisions

**Direct implementation:** 以已配置 upstream 为推送前提。不存在 remote/upstream 或推送被拒绝时，保留本地 commit 并显式记录阻塞，不猜测外部目标。

## Behaviour

- Given 一个 change 的准出条件已满足, When 交付, Then 仅暂存其所属文件并创建语义化 Git commit。
- Given 当前分支已有 upstream, When commit 成功, Then 自动推送该分支。
- Given 没有 remote 或 upstream, When change 完成, Then 不创建外部仓库，记录 push 阻塞与需要用户提供的目标。

## Acceptance & Evidence

- [x] `AGENTS.md` 写明自动 commit/push 与无远端例外。
- [pending] 已完成 changes 已按语义提交。
- [pending] 远端/upstream 状态已读取并回填。

## Tasks & Current State

1. [done] 写入仓库规则。
2. [in progress] 提交当前已完成 changes。
3. [pending] 推送或记录外部阻塞。

## Delivery Snapshot

Pending Git preflight and commit.
