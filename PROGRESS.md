# 开发进度日志

> 实时记录每个 PR 完成情况、关键决策、遇到的问题。每完成一个 PR 更新此文件。

## 时间线

### 2026-05-29 (D1)

- **00:00** 题目发布
- **00:05** 选题完成:题三 AI PR Review 助手(理由见 PLAN.md)
- **00:06** PLAN.md 落盘,完成方案构思
- **00:07** GitHub 仓库 `LittleChiu/ai-pr-reviewer` 创建
- **00:08** 初始化 README / .gitignore / LICENSE / .env.example / PROGRESS.md
- **00:14** PR #1 合并:FastAPI 骨架,CI 跑通(中途遇到 `defaults.working-directory` 在目录不存在时 GHA 无法启动 step,改为各步骤显式声明修复)
- **00:14** 进入 PR #2:GitHub PR 数据获取

## PR 列表

| # | 标题 | 状态 | 说明 |
|---|---|---|---|
| _init_ | 仓库骨架 | ✅ main | README + 配置文件 |
| #1 | feat(backend): FastAPI 骨架与 /api/health | ✅ merged | 后端服务起点,CI 跑通 |
| #2 | feat(backend): GitHub PR 数据获取 | ✅ merged | URL 解析 + httpx 客户端 + /api/pr/{parse,fetch} |
| #3 | feat(backend): LLM 评审核心 | ✅ merged | OpenAI SDK 封装 + reviewer + /api/review |
| #4 | feat(frontend): Next.js 骨架 | 🚧 开发中 | 主页 / 输入框 / 报告渲染组件 / API 客户端 |

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
