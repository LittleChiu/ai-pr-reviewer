# 开发进度日志

> 实时记录每个 PR 完成情况、关键决策、遇到的问题。每完成一个 PR 更新此文件。

## 时间线

### 2026-05-29 (D1)

- **00:00** 题目发布
- **00:05** 选题完成:题三 AI PR Review 助手(理由见 PLAN.md)
- **00:06** PLAN.md 落盘,完成方案构思
- **00:07** GitHub 仓库 `LittleChiu/ai-pr-reviewer` 创建
- **00:08** 初始化 README / .gitignore / LICENSE / .env.example
- **00:14** PR #1 合并:FastAPI 骨架,CI 跑通
- **00:20** PR #2 合并:GitHub PR 数据获取
- **00:24** PR #3 合并:LLM 评审核心(端到端实测产出真实评审报告)
- **00:37** PR #4 合并:Next.js 16 前端骨架
- **00:56** PR #5 合并:前后端串联 + 部署文档 → **MVP 闭环完成**

## PR 列表

| # | 标题 | 状态 | 说明 |
|---|---|---|---|
| _init_ | 仓库骨架 | ✅ main | README + 配置文件 |
| #1 | feat(backend): FastAPI 骨架与 /api/health | ✅ merged | 后端服务起点,CI 跑通 |
| #2 | feat(backend): GitHub PR 数据获取 | ✅ merged | URL 解析 + httpx 客户端 + /api/pr/{parse,fetch} |
| #3 | feat(backend): LLM 评审核心 | ✅ merged | OpenAI SDK 封装 + reviewer + /api/review |
| #4 | feat(frontend): Next.js 16 骨架 + 评审报告 UI | ✅ merged | 主页 / 输入框 / 报告渲染 / API 客户端 |
| #5 | feat: 前后端串联 + 部署文档 | ✅ merged | CORS / HealthBadge / dev.sh / docs/deploy.md |

## 关键决策

记录开发过程中影响后续走向的决策。

- **2026-05-29 00:00** · 选题三 — 见 PLAN.md "为什么是题三"
- **2026-05-29 00:00** · LLM 网关锁定 yorhamc.com,模型分四档(主/快/视觉/兜底)
- **2026-05-29 00:00** · 上下文获取深度:diff + 改动文件全文(B 方案)
- **2026-05-29 00:00** · 三层 prompt 策略(文件级 → 块级 → 行级)
- **2026-05-29 00:14** · CI working-directory 必须各步骤显式声明,不能用 \`defaults\`
  (目录不存在时 GHA 无法启动 step)
- **2026-05-29 00:30** · 前端锁定 pnpm 10.34.1
  (pnpm 11.4 strict-dep-builds + workspace.yaml 副作用太多,KISS 选 10)
- **2026-05-29 00:50** · 后端进程必须显式 \`HTTP_PROXY/HTTPS_PROXY\`,
  httpx 才会用代理访问 api.github.com

## 阻塞与已知问题

详见 [BLOCKERS.md](./BLOCKERS.md)。

## 下一步规划

MVP 已完成,后续按 PLAN.md "里程碑 D1 下午 ~ D3" 演进:

- [ ] PR #6:三层 prompt 评审策略(文件级粗筛 → 块级 → 行级)
- [ ] PR #7:SQLite 缓存,同 commit SHA 不重复消耗 token
- [ ] PR #8:前端流式 SSE,先看到总结再看到 risks
- [ ] PR #9:视觉模型可选(对 PR 描述里的截图做分析)
- [ ] PR #10:Vercel 部署 + Cloudflare Tunnel 配置 + Demo 视频脚本
- [ ] PR #11:README 打磨 + 模型策略文档
