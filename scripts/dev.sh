#!/usr/bin/env bash
# 一键启动后端 + 前端开发服务器。Ctrl-C 同时关闭两者。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 颜色
B="\033[1;34m"; G="\033[0;32m"; Y="\033[0;33m"; R="\033[0;31m"; N="\033[0m"

# 进程清理
PIDS=()
cleanup() {
  printf "\n${Y}[dev] 关闭子进程...${N}\n"
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 检查环境
if [[ ! -f backend/.env ]] && [[ -f .env.example ]]; then
  printf "${Y}[dev] 复制 .env.example 到 backend/.env(请编辑填入 OPENAI_API_KEY)${N}\n"
  cp .env.example backend/.env
fi

# 后端
printf "${B}[dev] 启动后端 (FastAPI :8000)...${N}\n"
(
  cd backend
  exec uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
PIDS+=("$!")

# 前端
printf "${B}[dev] 启动前端 (Next.js :3000)...${N}\n"
(
  cd frontend
  if [[ ! -d node_modules ]]; then
    pnpm install
  fi
  exec pnpm dev
) &
PIDS+=("$!")

printf "\n${G}[dev] 后端 http://localhost:8000  ·  前端 http://localhost:3000${N}\n"
printf "${G}[dev] Ctrl-C 退出${N}\n\n"

wait
