# 模型选择策略

> 题目原文要求:"说明系统在**模型选择、上下文获取方式及未来扩展方向**上的设计思路"。
> 本文是答案。

## 一、为什么是分档而不是一个模型打天下?

让一个模型同时承担"快速分类"和"深度评审"是反直觉的——这两类任务对模型能力的需求差距很大:

| 任务 | 主要需要的能力 | 工具特征 |
|---|---|---|
| 文件粗筛(deep/normal/skip)| 上下文理解 + 分类决策 | 输入小、输出小、并发友好、错了无大碍 |
| 代码深审(找 bug/性能/安全)| 强推理 + 长上下文 | 输入大、输出结构化、错误成本高 |

把两者用同一个模型,要么粗筛阶段过度浪费(\`o1\` 级模型做分类)、要么深审阶段欠拟合(\`gpt-3.5\` 类模型查不出真 bug)。**分档**让每一层用合适尺寸的模型,**性价比和质量同时优化**。

## 二、当前的四档模型

通过 OpenAI 兼容协议接入 [your-gateway.example.com](https://https://your-gateway.example.com/v1) 中转网关:

| 档位 | 默认模型 | 用途 | 何时启用 |
|---|---|---|---|
| **PRIMARY** | \`deepseek-v4-pro-max\` | 文件级深度评审 | layered 第二层 |
| **FAST** | \`deepseek-v4-flash\` | 整体粗筛、attention 分类 | layered 第一层 |
| **VISION** | \`gemini-3.1-flash-lite\` | 多模态理解(预留) | PR 描述含截图时 |
| **FALLBACK** | \`claude-sonnet-4-6\` | 主路失败时兜底 | 任意模型抛 \`APIError\` |

切换模型只需改 \`.env\`,无需改代码。\`LLMClient.chat_json(models=[...])\` 接受候选列表,**主→兜底**链由调用方传入,业务代码与具体模型解耦。

## 三、为什么默认选这几个?

### \`deepseek-v4-pro-max\` 当主推理
- **强推理**(reasoning_content 显示 chain-of-thought)、长上下文,能在文件全文里跨段推断
- 性价比高,比同档 GPT 系便宜 5-10x
- 国内可用、稳定

### \`deepseek-v4-flash\` 当粗筛
- 同一家,输出风格一致,聚合时 schema 兼容性好
- 速度快(单次粗筛通常 2-5s)
- 廉价,粗筛任务对模型能力要求不高

### \`gemini-3.1-flash-lite\` 当视觉
- 多模态原生支持(图片 + 文字)
- 当前 yorhamc 上**已实测可用**(其它 gemini-3.1 视觉模型如 \`flash-image\` 网关侧未配置价格,见 BLOCKERS.md)
- 视觉是可选 feature,不阻塞主路

### \`claude-sonnet-4-6\` 当兜底
- 与 deepseek 调用语义等价,fallback 切换零适配成本
- 主路 LLM 网关历史上发生过 \`upstream_error\`,需要异家兜底

## 四、模型 fallback 链是怎么工作的?

\`\`\`python
# app/services/llm_client.py
async def chat_json(self, *, models: list[str], system, user, ...):
    last_error = None
    for model in models:
        try:
            return await self._call(model, ...)  # 任一成功即返回
        except (APIError, LLMError) as e:
            last_error = e
            continue
    raise LLMError(f"所有候选模型都失败: {last_error}")
\`\`\`

调用方决定降级链:

\`\`\`python
# 粗筛:fast 挂了直接切 fallback,不试 primary 是因为 primary 太贵
await llm.chat_json(models=[fast_model, fallback_model], ...)

# 深审:primary 挂了切 fallback,fallback 也是强模型
await llm.chat_json(models=[primary_model, fallback_model], ...)
\`\`\`

## 五、上下文获取方式

题目原文另一个关键问题:"上下文获取方式"。

### 三种深度的对比

| 方案 | 准确度 | 开发量 | token 消耗 | 我们的选择 |
|---|---|---|---|---|
| A. 仅 diff | 低(误报多)| 低 | 低 | ❌ |
| B. diff + 改动文件全文 | 中-高 | 中 | 中 | ✅ |
| C. 整个仓库 AST 索引 | 高 | 高 | 高 | ❌(72h 不现实)|

**选 B**。具体实现:

1. \`fetch_pr_files\` 拿 diff(GitHub API \`pulls/N/files\`)
2. \`fetch_file_at_ref\` 在深审阶段**按需**拉文件全文(\`raw.githubusercontent.com/<owner>/<repo>/<head_sha>/<path>\`),不计 GitHub API 限流
3. 喂模型时同时给"该文件 patch"+"该文件全文",让模型在上下文里理解 diff,大幅降低误报

### 为什么不用 GitHub Contents API 拿文件?
- 它返回 base64 编码,要解码
- 计入 5000/h API 限流
- raw.githubusercontent.com 直接拿明文,不限流

### 大 PR 的截断策略

| 资源 | 上限 | 超出处理 |
|---|---|---|
| 单文件 patch | 30K 字符 | 截断 + "...(已截断)"提示 |
| 单文件全文 | 30K 字符 | 同上 |
| 改动文件总数 | \`max_files=300\` | 超出不拉 |
| 进入深审的文件 | \`max_deep_files=8\` | 按 changes 排序取前 8 |
| PR 描述 | 3K-4K 字符 | 截断 |
| 整体 diff(single 策略) | 60K 字符 | 截断 |

巨型 PR 不会让请求爆 token,优雅降级而非失败。

## 六、未来扩展方向

### 6.1 加入更多模型档位
- **专家模型**:针对特定语言/框架(Rust 的 \`Polaris\` 类、Python 安全的 \`bandit-llm\`)
- **更便宜的粗筛**:\`Qwen-flash\` 或 \`Gemini-flash-lite\` 替代当前 deepseek-flash

### 6.2 上下文获取升级
- **类型推断辅助**:在 deep review 前对改动函数做轻量 LSP 分析,把"这个变量的类型/调用方"塞进 prompt
- **历史 PR 学习**:仓库历史的 review comment 喂给模型当 few-shot,做"这个仓库风格的"评审
- **依赖图感知**:删除某个公共函数时,自动拉取调用它的所有文件给模型看

### 6.3 分布式与缓存
- **commit SHA 缓存**:同一 commit 已审过,直接返回缓存结果(下一个 PR 实现)
- **文件级缓存**:相邻 commit 大量文件未改,深审结果可复用
- **多用户 ratelimit + token 计费**:走向产品化时必备

### 6.4 与 GitHub 深度集成
- **GitHub App**:PR 创建即自动评审,以 review comment 形式回写
- **commit-level 实时反馈**:每个 push 触发增量评审

### 6.5 视觉能力激活
当前视觉模型已接通,但需要 LLM 网关把 \`gemini-3.1-flash-image\` 等视觉模型价格配上。激活后可:
- 解析 PR 描述里的架构图截图,理解设计意图
- 对前端 PR 自动跑视觉回归(部署预览 vs 旧版截图)
