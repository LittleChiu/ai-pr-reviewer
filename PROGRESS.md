# 开发进度日志

> 实时记录每个 PR 完成情况、关键决策、遇到的问题。每完成一个 PR 更新此文件。

## 时间线

### 2026-05-29 (D1)

- **00:00** 题目发布
- **00:05** 选题完成:题三 AI PR Review 助手(理由见 PLAN.md)
- **00:06** PLAN.md 落盘,完成方案构思
- **00:07** GitHub 仓库 `LittleChiu/ai-pr-reviewer` 创建
- **00:08** 初始化 README / .gitignore / LICENSE / .env.example / PROGRESS.md

## PR 列表

| # | 标题 | 状态 | 说明 |
|---|---|---|---|
| _init_ | 仓库骨架 | ✅ main | README + 配置文件,直推 main(此为 init,后续全走 PR) |

## 关键决策

记录开发过程中影响后续走向的决策。

- **2026-05-29 00:00** · 选题三 — 见 PLAN.md "为什么是题三"
- **2026-05-29 00:00** · LLM 网关锁定 yorhamc.com,模型分四档(主/快/视觉/兜底)
- **2026-05-29 00:00** · 上下文获取深度:diff + 改动文件全文(B 方案)
- **2026-05-29 00:00** · 三层 prompt 策略(文件级 → 块级 → 行级)

## 阻塞与已知问题

详见 [BLOCKERS.md](./BLOCKERS.md)。

## 待办

按 PLAN.md 的里程碑推进,任务清单实时维护在 Claude Code 的 TaskList。
