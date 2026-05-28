# 架构与设计

## 一、整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         浏览器(用户)                              │
│                                                                  │
│  POST /api/review/stream { url: "https://github.com/.../pull/N" }│
└────────────────────────────────┬─────────────────────────────────┘
                                 │ SSE(text/event-stream)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js 16 (App Router) · Vercel                │
│                                                                  │
│  src/app/page.tsx          ─ 状态机 + SSE 帧解析 + 增量渲染       │
│  src/lib/api.ts            ─ reviewPRStream(fetch + ReadableStream)│
│  src/components/HealthBadge ─ 实时后端连通指示                   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ HTTPS(Cloudflare Tunnel)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│           FastAPI · 自建 GPU 服务器                               │
│                                                                  │
│  api/review.py                                                   │
│   ├─ POST /api/review        非流式(layered 或 single)           │
│   └─ POST /api/review/stream SSE 流式(始终 layered)              │
│                                                                  │
│  services/                                                       │
│   ├─ pr_url.py               URL 解析                            │
│   ├─ github_client.py        异步 httpx + raw.githubusercontent  │
│   ├─ reviewer.py             single 策略                          │
│   ├─ reviewer_layered.py     layered 策略 + 流式                  │
│   ├─ llm_client.py           OpenAI 兼容 + fallback 链            │
│   ├─ github_schema.py        GitHub 数据 pydantic 模型            │
│   └─ review_schema.py        ReviewReport pydantic 模型           │
│                                                                  │
│  core/config.py              pydantic-settings,从 .env 读所有配置 │
└──────────┬─────────────────────────────────────┬─────────────────┘
           │                                     │
           ▼                                     ▼
┌──────────────────────┐              ┌──────────────────────────┐
│ GitHub REST API      │              │ LLM Gateway              │
│ - pulls/N            │              │ https://your-gateway.example.com/v1           │
│ - pulls/N/files      │              │ (OpenAI 兼容协议)        │
│ - 文件全文           │              │                          │
│ raw.githubusercontent│              │ deepseek / claude / gemini│
└──────────────────────┘              └──────────────────────────┘
```

## 二、Layered 评审的事件流

```
浏览器                后端              LLM        GitHub
  │                    │                │            │
  ├ POST /stream ──────▶                │            │
  │                    ├ fetch PR ──────────────────▶│
  │                    │◀──────────── metadata + files│
  │◀ event: started ───│                │            │
  │                    │                │            │
  │                    ├ triage(fast)──▶│            │
  │                    │◀──────────── summary+attention
  │◀ event: triage ────│                │            │
  │                    │                │            │
  │                    ├ deep file_1 ──▶│            │
  │                    ├ deep file_2 ──▶│            │
  │                    ├ deep file_3 ──▶│ (并发,Sem=3)│
  │                    │                │            │
  │◀ file_started ×3 ──│                │            │
  │                    │                │            │
  │                    │◀──── result ───│            │
  │◀ event: file_done ─│                │            │
  │                    │◀──── result ───│            │
  │◀ event: file_done ─│                │            │
  │                    │◀──── result ───│            │
  │◀ event: file_done ─│                │            │
  │◀ event: done ──────│                │            │
```

## 三、关键设计决策

### 决策 1:为什么前端不用 EventSource?

浏览器原生 \`EventSource\` 只支持 GET,我们需要传 PR URL 做 body,所以用 \`fetch + ReadableStream\` 自手动解析 SSE 帧。代码 ~30 行,不引第三方库。

### 决策 2:为什么 LLM 输出强制 JSON?

- 减少幻觉:JSON schema 引导模型按字段思考
- 直接喂 pydantic 验证,坏数据当场报错
- 前端拿到结构化 schema,渲染逻辑确定
- \`extract_json\` 工具容忍 \`\`\`json fence + 前后缀文本

### 决策 3:为什么后端不放 Vercel?

Vercel Functions 60s 超时,layered 评审一轮 30-90s,巨型 PR 更长。我们用自建服务器 + Cloudflare Tunnel 暴露公网。GPU 资源还能为未来本地推理预留可能性。

### 决策 4:为什么 GitHub 数据走两套接口?

- \`pulls/N\` + \`pulls/N/files\`:走 GitHub REST API,需要 \`Authorization: Bearer\` 头
- 文件全文:走 \`raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>\`,**免 base64 解码 + 不计 API 限流**

### 决策 5:为什么 FastAPI 而不是 Next.js Route Handlers?

- Python 生态 LLM 接入更顺(\`openai\` SDK + \`pydantic\`)
- 异步并发深审需要 \`asyncio.Semaphore\`,Python 一行搞定
- 后端可独立横向扩展、独立监控、独立缓存

### 决策 6:为什么用 OpenAI SDK 而不是直接 httpx?

- LLM 网关 OpenAI 兼容,SDK 已经实现重试、错误码、流式
- 切换主流模型(deepseek/claude/openai 等)只改 \`base_url + model\`,业务代码零改动
- SDK 内置 retry-after 处理

## 四、扩展点

### 评审策略
- 新增策略只需在 \`reviewer*.py\` 加一个文件,实现 \`async def review(...) -> ReviewReport | AsyncIterator[ReviewEvent]\`
- 在 \`/api/review\` 路由的 \`strategy\` 字段加一个 enum 值
- 测试只需加假 LLM 注入

### 模型档位
- 在 \`Settings\` 加新字段(如 \`security_model\`)
- \`reviewer.py\` 决定何时使用

### 新数据源
- 把 \`GitHubClient\` 改成 \`PRClient\` 抽象
- 加 \`GitLabClient\` / \`GiteaClient\` 实现
- \`pr_url.py\` 多支持几种格式

### 缓存
- \`/api/review\` 进入前先查 \`(repo, head_sha) -> ReviewReport\` 的 SQLite 表
- 命中即返回,未命中才走 LLM
- 详见 PLAN.md "未来扩展"
