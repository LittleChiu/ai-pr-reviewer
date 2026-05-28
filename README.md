# 🤖 AI PR Review 助手

> An AI-powered Pull Request review assistant. Paste a PR URL, get a smart review report.

[![CI](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/ci.yml)

> 七牛云 XEngineer 新工科计划 · 2026.05.29 批次 · 题三作品

## 这是什么

把 GitHub PR 链接丢进来,几秒钟拿回一份评审报告:

- 📋 **PR 变更总结** — 用人话说清楚改了什么、为什么改、改在哪些层
- ⚠️ **风险代码识别** — 标记可能的 bug / 性能 / 安全隐患,带置信度
- 💡 **Review 建议** — 指向具体行的可立即采纳的修改建议

## Demo

> Demo 视频链接将在开发完成后补充

## 为什么不一样

通用 ChatGPT prompt 看 PR 的痛点是:**只看 diff,不看上下文**。我们做了三件事:

1. **跨文件上下文** — 拉取 PR 涉及文件的完整内容,让模型看见"前后文",大幅降低误报
2. **三层 Prompt 策略** — 文件级粗筛 → 块级深入 → 行级建议,各档位用不同模型
3. **置信度 + 依据引用** — 每条建议带证据和置信度,reviewer 一眼判断采纳/忽略

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 15 (App Router) + Tailwind + shadcn/ui |
| 后端 | FastAPI + uv + httpx |
| 数据 | SQLite + SQLModel(缓存评审结果) |
| LLM | DeepSeek V4 系列(主力) + Claude 4.6(兜底) + Gemini 3.1(视觉) |
| 部署 | 前端: Vercel · 后端: 自建 + Cloudflare Tunnel |

完整方案见 [PLAN.md](./PLAN.md)。

## 快速开始

```bash
# 后端
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
pnpm install
pnpm dev
```

需要的环境变量见 `.env.example`。

## 项目结构

```
ai-pr-reviewer/
├── backend/          # FastAPI 后端
├── frontend/         # Next.js 前端
├── docs/             # 设计文档
├── PLAN.md           # 完整方案
└── PROGRESS.md       # 开发进度日志
```

## 模型选择思路

OpenAI 兼容协议下接入多个模型,按任务档位分流:

- 主推理: `deepseek-v4-pro-max` — 长上下文 + 强推理 + 性价比
- 快速分类: `deepseek-v4-flash` — 文件粗筛、低成本高频任务
- 多模态: `gemini-3.1-flash-lite` — PR 描述含截图/架构图时启用
- 兜底: `claude-sonnet-4-6` — 主路降级保障

详见 [docs/model-strategy.md](./docs/model-strategy.md)(开发中)。

## 未来扩展方向

- [ ] GitHub App 直接集成,自动评审新 PR
- [ ] 支持 GitLab / Gitee
- [ ] 团队规范文档导入,做"你们团队风格"的评审
- [ ] 历史 PR 训练个性化偏好

## License

MIT
