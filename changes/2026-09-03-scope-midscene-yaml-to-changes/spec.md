# Scope Midscene YAML to Changes

**Status:** Delivered

## Context & Goal

让视觉自动化用例与其需求、准出条件和交付状态共存，避免根目录测试资产无法追溯到具体 change。

## Scope & Non-goals

- In scope: 后续 Midscene YAML 的目录约定。
- Non-goals: 迁移 SDD 建立前的根目录 smoke，或改变 Midscene CLI、报告目录和模型配置。

## Decisions

**Direct implementation:** 这是对轻量 SDD 的单一目录规则补充。新 YAML 使用 `changes/<change-id>/midscene/*.yaml`；根目录 `midscene/` 保留为历史资产。

## Behaviour

- Given 一个新 change 需要可见 UI、输入或渲染验证, When 新增或修改 Midscene YAML, Then YAML 存放在该 change 的 `midscene/` 子目录。
- Given 一个 change 被恢复或审核, When 读取其 `spec.md`, Then 同目录可定位其视觉自动化用例。

## Acceptance & Evidence

- [x] `AGENTS.md` 写明新 YAML 的归属规则和历史例外。
- [x] 本 change 的 spec 与规则一起可追溯。
- [x] `npm run build` 通过；`git diff --check` 通过。

## Tasks & Current State

1. [done] 明确目录约定与历史资产边界。
2. [done] 执行配置变更验证。

## Delivery Snapshot

已增加变更级 Midscene YAML 归属规则，并保留历史根目录 smoke 例外。验证：`npm run build`、`git diff --check`。
