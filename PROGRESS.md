# 开发进度日志

> 实时记录每个 PR 完成情况、关键决策、遇到的问题。每完成一个 PR 更新此文件。

## 时间线

### 2026-05-29 (D1)

#### 凌晨 — MVP+ 全部核心能力完成

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
- **00:59** PR #6 合并:PROGRESS.md 更新
- **01:08** PR #7 合并:三层 prompt 评审策略(差异化亮点)
- **01:18** PR #8 合并:SSE 流式渲染(用户体验大幅提升)
- **01:25** PR #9 合并:README 重写 + architecture/model-strategy 文档
- **01:36** PR #10 合并:SQLite 缓存 + JSON 解析容错 → **MVP+ 完成**

#### D1 上午之后(规划)

凌晨节奏过快,后续保持每小时检查一次进度,把工作均匀分布到 D1 下午、D2 全天、D3 上午。

## PR 列表

| # | 标题 | 状态 | 类别 |
|---|---|---|---|
| _init_ | 仓库骨架 | ✅ main | 基础 |
| #1 | feat(backend): FastAPI 骨架与 /api/health | ✅ merged | 基础 |
| #2 | feat(backend): GitHub PR 数据获取 | ✅ merged | 基础 |
| #3 | feat(backend): LLM 评审核心 | ✅ merged | 基础 |
| #4 | feat(frontend): Next.js 骨架 + 评审报告 UI | ✅ merged | 基础 |
| #5 | feat: 前后端串联 + 部署文档 | ✅ merged | 基础 |
| #6 | docs: PROGRESS.md 更新至 MVP 闭环 | ✅ merged | 文档 |
| #7 | feat(backend): 三层 prompt 评审策略 | ✅ merged | 核心增强 |
| #8 | feat: SSE 流式评审,前端边读边渲染 | ✅ merged | 核心增强 |
| #9 | docs: README 重写 + architecture/model-strategy | ✅ merged | 文档 |
| #10 | feat(backend): SQLite 评审缓存 + JSON 解析容错 | ✅ merged | 核心增强 |

## 关键决策

记录开发过程中影响后续走向的决策。

- **2026-05-29 00:00** · 选题三 — 见 PLAN.md "为什么是题三"
- **2026-05-29 00:00** · LLM 网关锁定 yorhamc.com,模型分四档(主/快/视觉/兜底)
- **2026-05-29 00:00** · 上下文获取深度:diff + 改动文件全文(B 方案)
- **2026-05-29 00:00** · 三层 prompt 策略(文件级 → 块级 → 行级)
- **2026-05-29 00:14** · CI working-directory 必须各步骤显式声明,不能用 `defaults`
- **2026-05-29 00:30** · 前端锁定 pnpm 10.34.1(pnpm 11.4 strict-dep-builds 副作用太多)
- **2026-05-29 00:50** · 后端进程必须显式 `HTTP_PROXY/HTTPS_PROXY`,httpx 才会用代理
- **2026-05-29 01:08** · 三层 prompt 实测对比:layered 比 single 多 3x 用时,但 risks 数量 +50%、质量更高 — 选 layered 默认
- **2026-05-29 01:18** · SSE 不用 EventSource(原生不支持 POST body),手写 ~30 行解析
- **2026-05-29 01:36** · LLM 输出偶尔含智能引号/控制字符,加 `_clean_json_like` 二次容错

## 当前能力清单

✅ **三大核心**(题目原文要求):
- PR 变更总结(summary + highlights)
- 风险代码识别(risks,带 severity + category + confidence)
- Review 建议生成(suggestions,带 line_hint + code_hint)

✅ **差异化亮点**(竞争对手没有):
- 三层 prompt(粗筛 → 深审 → 聚合)
- 跨文件上下文(diff + 改动文件全文)
- 多模型 fallback 链
- SSE 流式渲染(5-15s 看到总览,30-90s 完整报告)
- commit SHA 缓存(同 PR 重复请求 0 秒)
- JSON 解析容错(LLM 抖动也不崩)

✅ **工程质量**:
- 后端 34 单测,ruff/mypy 全绿,pydantic schema 严格
- 前端 lint/typecheck/build 全绿
- CI 双 job(后端 + 前端),每 PR 必过
- 一键启动脚本 `scripts/dev.sh`
- 完整文档:PLAN / architecture / model-strategy / deploy

## 阻塞与已知问题

详见 [BLOCKERS.md](./BLOCKERS.md)。

## 后续计划(D1 下午 ~ D3)

不再连续猛推,把工作均匀分布。候选项目:

- [ ] **prompt 微调**:对比不同 system prompt 措辞,沉淀经验文档
- [ ] **观察性增强**:每次评审打印 token 消耗、模型用时,落到日志
- [ ] **大 PR 处理**:当 deep_files > 8 时,智能合并相邻文件的评审,减少调用次数
- [ ] **拉真实开源 PR 评审展示**:挑 1-3 个知名仓库的 PR 实测,作为 demo 视频素材
- [ ] **视觉模型激活**(BLOCKERS 解开后):分析 PR 描述里的截图
- [ ] **D3 上午 UI 打磨**:细节交互、空态、加载态优化
- [ ] **D3 部署**:Vercel + Cloudflare Tunnel,产线可访问
- [ ] **D3 下午 demo 视频脚本 + 录制(用户)**
