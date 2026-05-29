# 部署指南

## 本地开发

### 一键启动(推荐)

仓库根目录已提供 `scripts/dev.sh`,会同时拉起后端与前端:

```bash
./scripts/dev.sh
```

后端: <http://localhost:8000> · 前端: <http://localhost:3000>

按 `Ctrl-C` 同时关闭两个进程。

### 分开启动

后端:

```bash
cd backend
uv sync
cp ../.env.example .env  # 填入 OPENAI_API_KEY
uv run uvicorn app.main:app --reload --port 8000
```

前端:

```bash
cd frontend
pnpm install
cp .env.example .env.local  # 默认 API 指向 localhost:8000
pnpm dev
```

## 生产部署

### 方式一(最快):从 GHCR 拉预构建镜像

每次 main 分支推送会自动构建多架构(amd64 + arm64)镜像并推到
[GitHub Container Registry](https://github.com/LittleChiu/ai-pr-reviewer/pkgs/container).

只需要 `docker compose` 与 `.env`:

```bash
cp .env.example .env  # 编辑填入 OPENAI_API_KEY
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

镜像 tag 策略:
- `latest` — 跟随 main 滚动(默认)
- `sha-<commit>` — 固定到特定 commit,推荐生产用
- `v<version>` — semver tag(打 git tag `v0.1.0` 时自动构建)

固定到 sha:`IMAGE_TAG=sha-3845d4d docker compose -f docker-compose.prod.yml up -d`

### 方式二:本地 build Docker Compose

适合内网环境或想自定义镜像:

```bash
cp .env.example .env
docker compose up -d --build  # 用 docker-compose.yml,本地 build
```

### 方式三:前端 Vercel + 后端自建

### 前端 → Vercel

1. 在 <https://vercel.com> 用 GitHub 登录,导入 `LittleChiu/ai-pr-reviewer`
2. **Root Directory** 设为 `frontend`
3. **Environment Variables**:`NEXT_PUBLIC_API_BASE_URL=https://<你的后端公网地址>`
4. Deploy 一次,后续推 main 自动触发

### 后端 → 自建 + Cloudflare Tunnel

后端运行在自建服务器上,通过 Cloudflare Tunnel 暴露公网域名,免开端口、自带 HTTPS:

```bash
# 1. 安装 cloudflared
# (Ubuntu) curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb && sudo dpkg -i cf.deb

# 2. 登录并创建 tunnel
cloudflared tunnel login
cloudflared tunnel create ai-pr-reviewer
cloudflared tunnel route dns ai-pr-reviewer api.<your-domain>

# 3. 配置 ~/.cloudflared/config.yml:
#   tunnel: <tunnel-id>
#   credentials-file: ~/.cloudflared/<tunnel-id>.json
#   ingress:
#     - hostname: api.<your-domain>
#       service: http://localhost:8000
#     - service: http_status:404

# 4. 启动后端 + tunnel(systemd 或 supervisor 管理)
cloudflared tunnel run ai-pr-reviewer
```

完成后,前端 \`NEXT_PUBLIC_API_BASE_URL\` 指向 \`https://api.<your-domain>\`,后端 \`CORS_ORIGINS\` 加入 Vercel 域名即可。

### 为什么不前后端都放 Vercel?

Vercel Functions 有 60 秒超时,LLM 评审一轮通常 20-90s,大 PR 可能更长。把后端放自建服务器或选 Docker Compose 部署,不受云厂商运行时限制。

## 环境变量速查

| 变量 | 位置 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | 后端 | LLM 网关 API Key |
| `OPENAI_BASE_URL` | 后端 | 默认 yorhamc 中转,可换其它 OpenAI 兼容服务 |
| `PRIMARY_MODEL` 等 | 后端 | 模型档位,见 `.env.example` |
| `GITHUB_TOKEN` | 后端 | 可选;读公开 PR 不需要,可大幅提升 rate limit |
| `CORS_ORIGINS` | 后端 | 生产环境允许跨域的来源(JSON 数组) |
| `CORS_ORIGIN_REGEX` | 后端 | 正则匹配(适合 Vercel 预览环境的动态子域) |
| `NEXT_PUBLIC_API_BASE_URL` | 前端 | 后端公网地址 |
