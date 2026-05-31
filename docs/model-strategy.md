# 模型选择策略

> 题目原文要求:"说明系统在**模型选择、上下文获取方式及未来扩展方向**上的设计思路"。
> 本文是答案。

## 一、两个模型，各司其职

系统只使用两个模型：

| 模型 | 默认 | 用途 |
|---|---|---|
| **PRIMARY** | `deepseek-v4-pro-max` | 所有文本评审任务：粗筛 + 深审 |
| **VISION** | `gemini-3.1-flash-lite` | 多模态理解(预留)：PR 描述含截图时 |

通过 OpenAI 兼容协议接入 [yorhamc.com](https://yorhamc.com/v1) 中转网关。

切换模型只需改 `.env`,无需改代码。

## 二、为什么默认选这两个?

### `deepseek-v4-pro-max` 当主模型
- **强推理**(reasoning_content 显示 chain-of-thought)、长上下文,能在文件全文里跨段推断
- 性价比高,比同档 GPT 系便宜 5-10x
- 国内可用、稳定
- 粗筛和深审都用它——粗筛不做分类的活不需要单独一个便宜模型,主模型多调用一次的 token 成本远低于多维护一个模型档位的心智负担

### `gemini-3.1-flash-lite` 当视觉
- 多模态原生支持(图片 + 文字)
- 当前 yorhamc 上**已实测可用**
- 视觉是可选 feature,不阻塞主路

## 三、上下文获取方式

题目原文另一个关键问题:"上下文获取方式"。

### 三种深度的对比

| 方案 | 准确度 | 开发量 | token 消耗 | 我们的选择 |
|---|---|---|---|---|
| A. 仅 diff | 低(误报多)| 低 | 低 | ❌ |
| B. diff + 改动文件全文 | 中-高 | 中 | 中 | ✅ |
| C. 整个仓库 AST 索引 | 高 | 高 | 高 | ❌(72h 不现实)|

**选 B**。具体实现:

1. `fetch_pr_files` 拿 diff(GitHub API `pulls/N/files`)
2. `fetch_file_at_ref` 在深审阶段**按需**拉文件全文(`raw.githubusercontent.com/<owner>/<repo>/<head_sha>/<path>`),不计 GitHub API 限流
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
| 改动文件总数 | `max_files=300` | 超出不拉 |
| 进入深审的文件 | `max_deep_files=8` | 按 changes 排序取前 8 |
| PR 描述 | 3K-4K 字符 | 截断 |
| 整体 diff(single 策略) | 60K 字符 | 截断 |

巨型 PR 不会让请求爆 token,优雅降级而非失败。

## 四、未来扩展方向

### 4.1 模型扩展
- **更换主模型**:改 `.env` 的 `PRIMARY_MODEL` 即可,零代码改动
- **激活视觉**:视觉模型已接通,后续可解析 PR 描述里的架构图截图

### 4.2 上下文获取升级
- **类型推断辅助**:在 deep review 前对改动函数做轻量 LSP 分析,把"这个变量的类型/调用方"塞进 prompt
- **历史 PR 学习**:仓库历史的 review comment 喂给模型当 few-shot,做"这个仓库风格的"评审
- **依赖图感知**:删除某个公共函数时,自动拉取调用它的所有文件给模型看

### 4.3 分布式与缓存
- **commit SHA 缓存**:同一 commit 已审过,直接返回缓存结果(已实现)
- **文件级缓存**:相邻 commit 大量文件未改,深审结果可复用
- **多用户 ratelimit + token 计费**:走向产品化时必备

### 4.4 与 GitHub 深度集成
- **GitHub App**:PR 创建即自动评审,以 review comment 形式回写
- **commit-level 实时反馈**:每个 push 触发增量评审

### 4.5 视觉能力激活
当前视觉模型已接通,激活后可:
- 解析 PR 描述里的架构图截图,理解设计意图
- 对前端 PR 自动跑视觉回归(部署预览 vs 旧版截图)

## 五、Prompt 工程笔记

更深入的 prompt 设计原则、踩过的坑、不同模型差异、未来调优方向 → 见 [docs/prompt-engineering.md](./prompt-engineering.md)。
