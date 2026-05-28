# Backend - AI PR Review

FastAPI 后端,负责调用 GitHub API 拉取 PR 与 LLM 网关执行评审。

## 启动

```bash
uv sync
cp ../.env.example .env  # 编辑填入 OPENAI_API_KEY
uv run uvicorn app.main:app --reload --port 8000
```

健康检查: <http://localhost:8000/api/health>

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
