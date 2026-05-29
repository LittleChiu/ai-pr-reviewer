.PHONY: help install dev backend frontend lint typecheck test build clean docker-build docker-up docker-down docker-logs

help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## 安装前后端依赖
	cd backend && uv sync --all-extras
	cd frontend && pnpm install

dev: ## 一键起前后端开发服务器
	./scripts/dev.sh

backend: ## 仅起后端
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend: ## 仅起前端
	cd frontend && pnpm dev

lint: ## 跑前后端 lint
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && pnpm lint

typecheck: ## 跑前后端类型检查
	cd backend && uv run mypy app
	cd frontend && pnpm typecheck

test: ## 跑后端测试
	cd backend && uv run pytest -v

build: ## 跑前端生产构建
	cd frontend && pnpm build

ci: lint typecheck test build ## 本地模拟 CI:跑全套检查

format: ## 自动格式化前后端代码
	cd backend && uv run ruff format .
	cd frontend && pnpm exec prettier --write "**/*.{ts,tsx,css,md}" --ignore-path .gitignore || true

clean: ## 清理构建产物与缓存
	rm -rf backend/.venv backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
	rm -rf frontend/.next frontend/node_modules
	rm -rf backend/data/*.db

docker-build: ## 构建 Docker 镜像
	docker compose build

docker-up: ## docker compose 启动
	docker compose up -d

docker-down: ## docker compose 停止并删除容器
	docker compose down

docker-logs: ## 看 docker compose 日志
	docker compose logs -f
