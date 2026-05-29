# 🤖 AI PR Review

> 粘贴 GitHub PR 链接，几秒看到总览，三十秒拿到带置信度的智能评审报告。

[![CI](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/ci.yml)
[![Docker](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/docker.yml/badge.svg)](https://github.com/LittleChiu/ai-pr-reviewer/pkgs/container/ai-pr-reviewer%2Fbackend)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)

> 七牛云 XEngineer 新工科计划 · 2026.05.29 批次 · 题三作品

## ✨ 这是什么

把 GitHub PR 链接丢进来，**SSE 流式**返回一份评审报告：

- 📋 **PR 总览** — 用人话说清楚改了什么、为什么改、改在哪些层
- ✨ **亮点** — 值得肯定的设计点
- ⚠️ **风险** — 可能的 bug / 性能 / 安全隐患（带 severity + confidence）
- 💡 **建议** — 指向具体行的可立即采纳的修改建议

## 🎬 Demo

> Demo 视频链接将在 D3 完成补上

**真实开源 PR 实测**:见 [docs/showcases/](./docs/showcases/) — 我们对 3 个公开仓库的真实 PR(fastapi、httpx)跑了一遍评审,直接抓到例如「`await` 同步文件对象的 TypeError」、「`os.path.getsize` 频繁系统调用」这类真实工程问题。

## 🆚 为什么和直接用 ChatGPT 不一样

通用「贴 diff 给 ChatGPT」的痛点：**只看 diff，不看上下文**。结果就是误报多、建议空泛。

我们做了三件事：

| 做法 | 解决什么问题 |
|---|---|
| **跨文件上下文** | 拉取改动文件的完整内容（不只是 diff），让模型在上下文里推理变量的实际用法，大幅降低误报 |
| **三层 Prompt 策略** | 文件级粗筛(快、便宜) → 块级深入(强模型 + 全文) → 行级聚合，各档位用合适尺寸的模型 |
| **置信度 + 依据引用** | 每条结论带证据和置信度，reviewer 一眼就能判断采纳 / 忽略，不再被 AI 噪音淹没 |

完整的产品需求调研与同类工具对比见 [docs/product-research.md](./docs/product-research.md)。

## 🏗️ 技术栈

| 层 | 选型 | 为什么 |
|---|---|---|
| 前端 | Next.js 16 (App Router) + Tailwind 4 + TypeScript | 一键 Vercel,SSE 流式渲染体验 |
| 后端 | FastAPI + uv + httpx | Python LLM 生态成熟,异步并发 |
| LLM | DeepSeek V4 (主) + Claude 4.6 (兜底) + Gemini 3.1 (视觉) | 通过 OpenAI 兼容协议接 yorhamc 中转 |
| 部署 | 前端 Vercel · 后端自建 + Cloudflare Tunnel | Vercel 60s 超时跑不完 LLM 评审 |

完整方案见 [PLAN.md](./PLAN.md)，架构图见 [docs/architecture.md](./docs/architecture.md)。后端启动后访问 `http://localhost:8000/docs` 可看自动生成的 OpenAPI 文档。

## 🚀 快速开始

最快方式 — 从 GHCR 拉预构建镜像:

```bash
cp .env.example .env  # 填 OPENAI_API_KEY
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
# 后端 :8000  前端 :3000
```

或本地 build:

```bash
cp .env.example .env
docker compose up -d --build
```

或本地开发(推荐 hot reload):

```bash
# 一键启动前后端
./scripts/dev.sh
```

或分别启动:

```bash
# 后端
cd backend
uv sync
cp ../.env.example .env  # 编辑填入 OPENAI_API_KEY
uv run uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。

## 🧠 模型选择思路

四档分工，OpenAI 兼容协议下任意切换（详见 [docs/model-strategy.md](./docs/model-strategy.md)）：

| 档位 | 默认模型 | 用途 |
|---|---|---|
| **PRIMARY** | `deepseek-v4-pro-max` | 文件级深度评审 |
| **FAST** | `deepseek-v4-flash` | 整体粗筛、attention 分类 |
| **VISION** | `gemini-3.1-flash-lite` | PR 描述含截图时(预留) |
| **FALLBACK** | `claude-sonnet-4-6` | 主路失败时兜底 |

模型 fallback 链由调用方传入：粗筛走 `fast → fallback`，深审走 `primary → fallback`。任意主路抖动都不会中断评审。

## 📡 上下文获取方式

`diff + 改动文件全文(变更后)` 的折中方案：

- 文件 patch 走 GitHub REST API（`pulls/N/files`）
- 文件全文按需走 `raw.githubusercontent.com/<owner>/<repo>/<head_sha>/<path>`，**免 base64 解码 + 不计 GitHub API 限流**
- 巨型 PR 用 `max_files=300` / `max_deep_files=8` / 单文件 30K 字符截断 优雅降级

详见 [docs/model-strategy.md](./docs/model-strategy.md#五上下文获取方式)。

## 📂 项目结构

```
ai-pr-reviewer/
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── api/            # /api/health, /api/pr/*, /api/review*
│   │   ├── services/       # github_client, llm_client, reviewer*
│   │   └── core/           # config.py, errors.py(统一错误处理)
│   ├── tests/              # 38 个用例,含 respx mock 与流式编排
│   └── Dockerfile          # python:3.11-slim + uv
├── frontend/               # Next.js 16 前端
│   └── src/
│       ├── app/page.tsx    # 主页:状态机 + SSE 渲染
│       ├── components/     # HealthBadge 等
│       └── lib/            # api.ts / types.ts / markdown.ts / useRecentUrls.ts
├── docs/
│   ├── architecture.md     # 系统架构与决策
│   ├── model-strategy.md   # 模型选择 / 上下文 / 扩展方向
│   ├── prompt-engineering.md # Prompt 设计原则与踩坑记录
│   ├── product-research.md # 产品需求调研与同类对比
│   ├── extending.md        # 6 个扩展点的落地步骤
│   ├── deploy.md           # 本地与生产部署(含 Docker)
│   └── showcases/          # 3 个真实 PR 评审样例(md + json)
├── docker-compose.yml      # 一行命令起前后端
├── Makefile                # make help / make ci / make dev ...
├── scripts/dev.sh          # 一键启动(非 Docker)
└── PLAN.md                 # 方案文档(开发前提交,72h 全程参照)
```

## 🛣️ 未来扩展方向

详见 [docs/extending.md](./docs/extending.md) — 包含 6 个主要扩展点的最小步骤说明:

- 加入新的 LLM 模型(改 `.env` 即可,无需改代码)
- 加入新的评审策略(focused / domain-specific 等)
- 接入新的代码托管平台(GitLab / Gitea)
- 加入视觉理解能力(分析 PR 描述里的截图)
- 加入团队规范的个性化评审
- 加入 GitHub App 集成(自动监听 PR 事件,以 review comment 回写)

## 📜 License

MIT
