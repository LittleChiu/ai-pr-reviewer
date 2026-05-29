# 常见问题与排障

## 部署相关

### 前端 /api 请求返回 500 或 ECONNREFUSED

**现象**：浏览器访问前端，页面正常但 `/api/health` 返回 500 或连接拒绝

**原因**：前端容器不知道后端在哪

**解决**：

```yaml
# docker-compose.prod.yml
frontend:
  environment:
    BACKEND_URL: "http://backend:8000"  # ← compose 服务名，不是 localhost
```

如果前后端都在 Docker 里跑，`BACKEND_URL` 必须用 compose 服务名（如 `backend`）。
如果后端在宿主机跑，用 `http://host.docker.internal:8000`（Mac/Windows）或 `http://172.17.0.1:8000`（Linux）。

改完记得**重启前端容器**：`docker compose restart frontend`

### GitHub API 连接超时

**现象**：后端日志 `ConnectError: api.github.com` 或超时

**解决**：

```bash
# .env 里改用镜像站
GITHUB_API_BASE=https://api.kkgithub.com
GITHUB_RAW_BASE=https://raw.kkgithub.com
```

重启后端容器生效。

### Docker 构建失败：COPY public/ not found

**现象**：`failed to compute cache key: "/app/public": not found`

**原因**：`public/` 目录为空，Docker COPY 找不到内容

**解决**：已在最新 Dockerfile 中修复。如果你用的是旧镜像，pull 最新版。

## LLM / 评审相关

### 模型返回空内容

**现象**：后端日志 `LLM model xxx failed: 模型 xxx 返回空内容`

**原因**：deepseek-v4-pro-max 等推理模型会先做 chain-of-thought（reasoning），
这些 reasoning tokens 计入 `max_tokens` 配额。如果 `max_tokens` 太小（如 2048），
reasoning 耗尽配额后 content 为空。

**解决**：已在最新代码中把 `max_tokens` 调到 4096。如果仍出现，
改 `.env` 换个模型试试：

```bash
PRIMARY_MODEL=deepseek-v4-flash  # 无 reasoning，不会占 content 配额
```

### Cloudflare 504 Gateway Timeout

**现象**：`Error code: 504 - Gateway time-out`，来自 yorhamc.com

**原因**：网关上游（OpenAI/DeepSeek 官方）瞬时过载

**解决**：
1. 等 2-3 分钟重试（错误提示 `retry_after: 120`）
2. 换一个模型：改 `.env` 的 `PRIMARY_MODEL`
3. 代码内置了同模型 3 次重试 + 跨模型 fallback（当前用单一模型）

### 评审结果质量差

**检查清单**：
1. 是否用的是 `deepseek-v4-flash`？换成 `deepseek-v4-pro-max` 推理更强
2. 是否 `max_tokens` 太小导致输出被截断？
3. 尝试切换 `strategy`：`single` 策略用完整 PR diff 看全局，适合小 PR

### 视觉模型分析图片失败

**现象**：日志 `vision analysis failed for model xxx`

**排查**：
1. 确认 `.env` 里 `VISION_MODEL` 值正确
2. 确认网关侧该模型已配价格／通道
3. 视觉分析失败**不阻塞主评审**，报告正常出，只是没有图片分析上下文

## 本地开发

### make ci 失败但 CI 通过

**可能原因**：
1. 本地没装 uv/pnpm
2. 本机无法直连外网（GitHub Actions runner 可以）
3. `next build` 下载 Google Fonts 超时 → `HTTP_PROXY=... make ci`

### pytest 报 ModuleNotFoundError: app

**原因**：没在 `backend/` 目录下跑

**解决**：`cd backend && uv run pytest`

### ruff/mypy 报错

**解决**：`make format` 自动格式化后重跑

## 诊断命令

```bash
# 后端健康
curl http://localhost:8000/api/health

# 后端日志
docker logs ai-pr-reviewer-backend --tail 50

# 前端日志
docker logs ai-pr-reviewer-frontend --tail 20

# 从前端容器测后端连通性
docker exec ai-pr-reviewer-frontend wget -qO- http://backend:8000/api/health

# 清缓存重新评审
curl -X DELETE http://localhost:8000/api/review/cache
```
