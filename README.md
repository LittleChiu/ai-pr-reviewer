# 🤖 AI PR Review

> 粘贴 GitHub PR 链接，几秒看到总览，三十秒拿到带置信度的智能评审报告。

[![CI](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleChiu/ai-pr-reviewer/actions/workflows/ci.yml)

> 七牛云 XEngineer 新工科计划 · 2026.05.29 批次 · 题三作品

## ✨ 这是什么

把 GitHub PR 链接丢进来，**SSE 流式**返回一份评审报告：

- 📋 **PR 总览** — 用人话说清楚改了什么、为什么改、改在哪些层
- ✨ **亮点** — 值得肯定的设计点
- ⚠️ **风险** — 可能的 bug / 性能 / 安全隐患（带 severity + confidence）
- 💡 **建议** — 指向具体行的可立即采纳的修改建议

## 🎬 Demo

> Demo 视频链接将在 D3 完成补上

## 🆚 为什么和直接用 ChatGPT 不一样

通用「贴 diff 给 ChatGPT」的痛点：**只看 diff，不看上下文**。结果就是误报多、建议空泛。

我们做了三件事：

| 做法 | 解决什么问题 |
|---|---|
| **跨文件上下文** | 拉取改动文件的完整内容（不只是 diff），让模型在上下文里推理变量的实际用法，大幅降低误报 |
| **三层 Prompt 策略** | 文件级粗筛(快、便宜) → 块级深入(强模型 + 全文) → 行级聚合，各档位用合适尺寸的模型 |
| **置信度 + 依据引用** | 每条结论带证据和置信度，reviewer 一眼就能判断采纳 / 忽略，不再被 AI 噪音淹没 |

## 🏗️ 技术栈

| 层 | 选型 | 为什么 |
|---|---|---|
| 前端 | Next.js 16 (App Router) + Tailwind 4 + TypeScript | 一键 Vercel,SSE 流式渲染体验 |
| 后端 | FastAPI + uv + httpx | Python LLM 生态成熟,异步并发 |
| LLM | DeepSeek V4 (主) + Claude 4.6 (兜底) + Gemini 3.1 (视觉) | 通过 OpenAI 兼容协议接 yorhamc 中转 |
| 部署 | 前端 Vercel · 后端自建 + Cloudflare Tunnel | Vercel 60s 超时跑不完 LLM 评审 |

完整方案见 [PLAN.md](./PLAN.md)，架构图见 [docs/architecture.md](./docs/architecture.md)。

## 🚀 快速开始

```bash
# 一键启动前后端
./scripts/dev.sh
```

或分别启动：

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

> **国内网络代理提示**：若需通过代理访问 `api.github.com`，启动后端时显式带 `HTTP_PROXY=<your-proxy>` 等环境变量。详见 [docs/deploy.md](./docs/deploy.md)。

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
│   │   └── core/config.py  # pydantic-settings
│   └── tests/              # 27 个用例,含 respx mock 与流式编排
├── frontend/               # Next.js 16 前端
│   └── src/
│       ├── app/page.tsx    # 主页:状态机 + SSE 渲染
│       ├── components/     # HealthBadge 等
│       └── lib/            # api.ts(含 SSE 解析) / types.ts
├── docs/
│   ├── architecture.md     # 系统架构与决策
│   ├── model-strategy.md   # 模型选择 / 上下文 / 扩展方向
│   └── deploy.md           # 本地与生产部署
├── scripts/dev.sh          # 一键启动
├── PLAN.md                 # 方案文档(开发前提交,72h 全程参照)
├── PROGRESS.md             # 开发进度日志(commit 时间分布证据)
└── BLOCKERS.md             # 阻塞与已决议项
```

## 🛣️ 未来扩展方向

详见 [docs/model-strategy.md § 六](./docs/model-strategy.md#六未来扩展方向)：

- GitHub App 直接集成,PR 创建即自动评审,以 review comment 形式回写
- 类型推断辅助(LSP)/ 依赖图感知 / 仓库历史 review 风格学习
- commit SHA 级别缓存,降低重复 token 消耗
- 视觉能力激活:解析 PR 描述里的架构图截图

## 📜 License

MIT
