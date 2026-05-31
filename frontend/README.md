# Frontend

Next.js 16 前端，负责提交 GitHub PR 链接并展示结构化评审结果。

## 当前交互方式

- 首页默认调用 `POST /api/review`
- 用户提交 PR URL 后等待分析完成
- 完成后一次性展示完整报告
- `src/lib/api.ts` 中仍保留 `reviewPRStream()`，作为后续恢复增量反馈时的预留能力

## 本地开发

```bash
pnpm install
pnpm dev
```

默认读取 `NEXT_PUBLIC_API_BASE_URL`；未配置时走相对路径，由本地代理或同域部署转发到后端。

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

## 关键目录

- `src/app/page.tsx` — 主页容器，负责提交、状态和结果组合
- `src/components/` — 展示组件与健康状态组件
- `src/lib/api.ts` — 后端 API 调用与错误解析
- `src/lib/types.ts` — 后端 schema 的 TypeScript 镜像
- `src/lib/markdown.ts` — 报告导出 Markdown
- `src/lib/useRecentUrls.ts` — 最近访问 PR URL 缓存
