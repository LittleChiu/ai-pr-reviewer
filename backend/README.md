# Backend - AI PR Review

FastAPI 后端,负责调用 GitHub API 拉取 PR 与 LLM 网关执行评审。

## 启动

```bash
uv sync
cp ../.env.example .env  # 编辑填入 OPENAI_API_KEY
uv run uvicorn app.main:app --reload --port 8000
```

> 国内网络环境若需通过代理访问 `api.github.com`,启动时显式带上代理:
>
> ```bash
> HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
>   NO_PROXY=localhost,127.0.0.1 \
>   uv run uvicorn app.main:app --port 8000
> ```

健康检查: <http://localhost:8000/api/health>

## 端点

- `GET  /api/health` — 服务状态 + 模型档位 + LLM 是否已配置
- `GET  /api/pr/parse?url=<PR_URL>` — 解析 PR URL 为 owner/repo/number
- `POST /api/pr/fetch` — 拉取完整 PR 数据(metadata + files + raw diff)

  请求体: `{"url": "<PR_URL>", "include_diff": true, "max_files": 300}`

## 测试

```bash
uv run pytest -q
```

## Lint / 类型

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app
```
