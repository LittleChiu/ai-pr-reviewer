# 扩展指南

> 本文档列出工具的主要扩展点,以及"如何加入一个新功能"的最小步骤。

## 目录

- [加入新的 LLM 模型](#加入新的-llm-模型)
- [加入新的评审策略](#加入新的评审策略)
- [接入新的代码托管平台(GitLab / Gitea)](#接入新的代码托管平台)
- [加入视觉理解能力](#加入视觉理解能力)
- [加入团队规范的个性化评审](#加入团队规范的个性化评审)
- [加入 GitHub App 集成](#加入-github-app-集成)

---

## 加入新的 LLM 模型

### 场景
yorhamc 网关后续上线了新的模型,或换用其它 OpenAI 兼容服务。

### 步骤
1. 在 `.env` / `.env.example` 加新变量,例如 `SECONDARY_MODEL=...`
2. 在 `backend/app/core/config.py` 的 `Settings` 加字段
3. 在调用方使用该模型

### 切换主模型
完全不改代码,只改 `.env`:

```bash
PRIMARY_MODEL=claude-sonnet-4-6  # 主路换 Claude
```

---

## 加入新的评审策略

### 场景
想做一种"focused"策略 — 只看用户在 PR 描述里 @ mention 的具体文件。

### 步骤
1. 新建 `backend/app/services/reviewer_focused.py`
2. 实现 `async def review_pr_focused(bundle, *, focus_files, ...) -> ReviewReport`
3. 在 `api/review.py` 的 `Strategy` Literal 加 `"focused"`
4. 在 `review` endpoint 的分支里调用新函数
5. 加测试:`tests/test_reviewer_focused.py`,用假 LLM 验证调用编排

新策略与现有策略**完全独立**,不影响 `single` / `layered` 行为。

---

## 接入新的代码托管平台

### 场景
让工具同时支持 GitLab MR 和 Gitea PR。

### 当前架构
`backend/app/services/github_client.py` 把 GitHub REST API 封装成 `fetch_pr_bundle(ref)`。
URL 解析在 `pr_url.py`,只认 GitHub URL。

### 步骤
1. **抽象客户端接口**:把 `GitHubClient` 中通用的方法名抽到一个 `Protocol` 或 `ABC`(`PRClient`)
   ```python
   class PRClient(Protocol):
       async def fetch_pr_bundle(self, ref: PRRef, ...) -> PRBundle: ...
       async def fetch_file_at_ref(self, ref: PRRef, path: str, sha: str) -> str | None: ...
   ```
2. 新建 `gitlab_client.py` / `gitea_client.py`,实现同一接口
3. **URL 解析支持新格式**:在 `pr_url.py` 的 `_PR_URL_PATTERNS` 加 GitLab/Gitea 的 URL 正则,
   `parse_pr_url` 同时返回平台标识(可在 `PRRef` 加 `platform: Literal["github", "gitlab", "gitea"]`)
4. **路由层根据 platform 选客户端**:`api/review.py` 用工厂函数 `get_client(ref.platform)` 取对应客户端
5. 测试:同一个 PR 在三个平台跑,行为应一致

### 注意
- GitLab 的 diff 字段叫 `diff_refs`,需要做字段映射
- Gitea API 兼容 GitHub,差异极小
- raw 文件 URL:GitLab 是 `/-/raw/`,Gitea 是 `/raw/`

---

## 加入视觉理解能力

### 场景
PR 描述里贴了架构图截图,希望模型理解后再做评审。

### 当前状态
模型档位里已有 `VISION_MODEL=gemini-3.1-flash-lite`,代码里**未启用**(可选 feature)。

### 步骤
1. 在 `services/github_schema.py` 的 `PRMetadata.body` 旁加 `body_images: list[str]`,内容是从 PR body 中正则抽到的图片 URL
2. 解析逻辑:`fetch_pr_metadata` 拿到 body 后用正则 `!\[.*?\]\((.*?)\)|<img[^>]*src=["']([^"']+)["']` 抽出所有图片 URL
3. 在 `_triage` 阶段,如果 `body_images` 不为空,触发**额外一次 vision 模型调用**:
   ```python
   resp = await llm.chat_json(
       model=vision_model,
       system="你是图像理解专家。识别这些图片是 PR 描述里的什么,...",
       ...
   )
   ```
4. 把视觉理解结果(如"这是一张系统架构图,描述了 X 与 Y 的关系")**注入到 deep review 的 user prompt 里**作为额外上下文
5. 加 feature flag `VISION_ENABLED=true`,默认关闭

### 注意
- yorhamc 网关需要先把视觉模型的价格配置上(目前 `gemini-3.1-flash-image` 等被网关锁住)
- 图片输入消耗 token 多(~1000/图),建议加每个 PR 最多分析 2 张图的限制

---

## 加入团队规范的个性化评审

### 场景
某个团队有自己的代码规范文档(例如内部 CODING_STYLE.md),希望评审时优先按这套规范来。

### 步骤
1. **支持每个仓库独立规范**:在请求 body 加 `style_guide: str` 字段(传规范文档的 markdown 文本或 URL)
2. **服务端规范缓存**:`services/style_guide.py`,按仓库 owner/repo 缓存规范文档(更新策略:基于文档的 ETag 或 Last-Modified)
3. **prompt 注入**:把规范文档的关键摘要作为 system prompt 的附加段:
   ```python
   system_prompt = DEEP_REVIEW_SYSTEM + f"\n\n## 这个仓库的代码规范\n{style_guide_summary}"
   ```
4. 测试:模拟团队规范("禁止使用单字母变量名"),传给评审,验证 risks 中能体现该规则

### 进阶
- 用 embedding + 向量库支持规范文档的语义检索,按当前 diff 内容动态选择最相关的规则段落注入 prompt
- 每个团队可上传 few-shot 样本(过去 PR 的 review comments),让模型学习这个团队的"评审风格"

---

## 加入 GitHub App 集成

### 场景
让工具自动监听 PR 创建/更新事件,以 review comment 形式回写评审结果到 GitHub。

### 步骤
1. **创建 GitHub App**(在 Settings → Developer Settings → GitHub Apps):
   - 权限:Pull requests (Read & Write), Contents (Read)
   - 订阅事件:`pull_request.opened`, `pull_request.synchronize`
2. **后端加 webhook endpoint** `POST /api/webhook/github`:
   - 验证签名(`X-Hub-Signature-256`)
   - 根据 event type 判断是否触发评审
   - 异步触发评审,完成后用 GitHub API 回写为 review comment
3. **回写逻辑**(`services/github_writeback.py`):
   - 把 `ReviewReport` 渲染为 markdown(复用 `frontend/src/lib/markdown.ts` 的逻辑)
   - 调 `POST /repos/:owner/:repo/issues/:number/comments` 发表评论
   - 或调 `POST /repos/:owner/:repo/pulls/:number/reviews` 发表 review(可绑定到具体行)
4. 测试:用 `smee.io` 转发本地 webhook,新建 PR 验证

### 注意
- GitHub App 鉴权用 JWT + installation token,与个人 token 不同
- webhook 处理要快速返回 200(< 10s),实际评审在后台异步跑
- 如果同一 PR 短时间内多次 push,应该 debounce(取消上一次评审,跑最新的)

---

## 一般原则

- **优先抽接口而不是改现有代码**:加新策略 / 新平台 / 新模型 时,新建文件实现接口,主路径完全不动
- **配置优于代码**:能用 `.env` 切换的,不要写硬编码
- **新功能加 feature flag**:默认关闭,稳定后改默认值;允许 fallback 到旧行为
- **测试覆盖关键编排**:关键链路用假 LLM/假 GitHub 注入,验证调用次数与顺序
