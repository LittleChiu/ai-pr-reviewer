# 贡献指南

欢迎贡献！无论是 bug 修复、功能建议、文档改进还是测试补充。

## 快速开始

```bash
git clone https://github.com/LittleChiu/ai-pr-reviewer.git
cd ai-pr-reviewer
cp .env.example .env  # 填 OPENAI_API_KEY
```

### 后端

```bash
cd backend
uv sync --all-extras
uv run pytest      # 跑测试
uv run ruff check .  # lint
uv run mypy app       # 类型检查
```

### 前端

```bash
cd frontend
pnpm install
pnpm dev          # 开发服务器
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm build        # 生产构建
```

### 全栈

```bash
make ci   # 跑完整 lint + typecheck + test + build
make dev  # 一键起前后端
```

## 开发约定

### Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): 简述

类型: feat / fix / docs / refactor / test / chore
范围: backend / frontend / ci / docs
```

示例:
- `feat(backend): /api/review/stream SSE 流式`
- `fix(frontend): middleware 运行时代理端口`
- `docs: 更新模型选择策略`

### PR 流程

1. 从 main 开 feature 分支: `git checkout -b feat/xxx`
2. 小粒度提交,每 commit 一个逻辑变更
3. 推分支 → 开 PR(使用 PR 模板)
4. CI(backend + frontend) 双绿后 squash merge

### 新评审策略

新建 `backend/app/services/reviewer_xxx.py`,实现:

```python
async def review_pr_xxx(...) -> ReviewReport: ...
```

在 `api/review.py` 的 `Strategy` Literal 加值,路由里分支调用。
详见 [docs/extending.md](./docs/extending.md)。

### 新模型接入

改 `.env` 即可:

```bash
PRIMARY_MODEL=你的新模型名
VISION_MODEL=你的视觉模型名
```

代码零改动。OpenAI 兼容协议即可。

## 测试指南

```bash
cd backend && uv run pytest -v

# 只跑某个模块
uv run pytest tests/test_reviewer_layered.py -v

# 带覆盖率
uv run pytest --cov=app --cov-report=term-missing
```

测试层级:
- **单元测试**:纯函数(image_utils、pr_url、extract_json)
- **集成测试**:用 respx mock HTTP 的 GitHub 客户端测试
- **编排测试**:用 FakeLLM 注入,验证 triage → deep × N 的调用顺序

## 发布

```bash
# Git tag 触发 GHCR 镜像构建(含 semver tag)
git tag v1.0.0
git push --tags
```

镜像自动推到 `ghcr.io/littlechiu/ai-pr-reviewer/{backend,frontend}:v1.0.0`。
