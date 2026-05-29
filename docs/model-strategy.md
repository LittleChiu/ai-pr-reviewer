# 模型选择策略

> 题目原文要求:"说明系统在**模型选择、上下文获取方式及未来扩展方向**上的设计思路"。
> 本文是答案。

## 一、为什么是双模型？

| 任务 | 主要需要的能力 | 特征 |
|---|---|---|
| 文本评审(粗筛 + 深审) | 强推理 + 长上下文 + JSON 遵守 | 输入大、输出结构化、错误成本高 |
| 多模态理解 | 视觉 + 文字联合推理 | PR 描述含截图时启用，非必须 |

粗筛和深审都依赖**同一类能力**(代码理解 + 推理)，分给两个模型带来的收益远小于增加的配置复杂度。简化成双模型后：

- 评审全链路(粗筛 → 深审 → 聚合)用同一个 PRIMARY_MODEL，一致性更好
- 多模态用 VISION_MODEL，按需激活
- `.env` 只需配两个模型名，新手友好

## 二、当前的双模型配置

通过 OpenAI 兼容协议接入中转网关：

| 档位 | 默认模型 | 用途 |
|---|---|---|
| **PRIMARY** | `deepseek-v4-pro-max` | 文本评审全链路:粗筛 + 逐文件深审 + 聚合 |
| **VISION** | `gemini-3.1-flash-lite` | PR 描述含截图时的视觉补充(预留) |

切换模型只需改 `.env`：

```bash
PRIMARY_MODEL=deepseek-v4-flash     # 换成更快但便宜一点的
VISION_MODEL=gemini-3.1-flash-lite
```

代码零改动。`LLMClient.chat_json(models=[model])` 接受可选候选列表，由调用方传入。

## 三、为什么默认选这两个？

### `deepseek-v4-pro-max` 当主模型
- 强推理(chain-of-thought)、长上下文，能在文件全文里跨段推断
- 性价比高，比同档 GPT 系便宜 5-10x
- 国内可用、稳定
- `deepseek-v4-flash` 作为备选(更快但便宜，适合高频调用)

### `gemini-3.1-flash-lite` 当视觉
- 多模态原生支持(图片 + 文字)，已实测可用
- 视觉是可选 feature，不阻塞主路
- 其它 gemini-3.1 视觉模型(如 `flash-image`)网关侧未配置价格，激活后可直接切换

## 四、容错策略:同模型重试，不跨模型 fallback

之前的设计是"主模型失败 → 兜底模型"，但如果网关侧同一个 key 的所有模型都走同一上游，跨模型 fallback 无法隔离真实故障(如上游 500)。

当前策略改为**同模型重试**：

```python
# app/services/llm_client.py
async def chat_json(self, *, models, ..., retries_per_model=2):
    for model in models:
        for attempt in range(retries_per_model + 1):  # 共 3 次尝试
            try:
                return await self._call(model, ...)
            except (APIError, LLMError) as e:
                continue  # 下次重试同模型
    raise LLMError(...)
```

- 网关瞬时返回空内容、连接抖动、超时 → 重试通常恢复
- 不需要多个不同的模型 key，降低配置门槛
- 如果确实需要跨模型 fallback，代码层面支持传入 `models=[model_a, model_b]`，只是当前默认只用单一模型

## 五、上下文获取方式

### 当前方案:diff + 改动文件全文(变更后)

| 数据来源 | 接口 | 限制 |
|---|---|---|
| PR diff(hunk) | GitHub REST API `pulls/N/files`，\`Accept: application/vnd.github.v3.diff\` | 原始 diff 文本 |
| 改动文件全文 | `raw.githubusercontent.com/<owner>/<repo>/<head_sha>/<path>` | 免 base64 解码 + 不计 API 限流 |

### 为什么选 diff + 全文(而不是纯 diff 或完整克隆)?

| 方案 | 准度 | 速度 | 复杂度 | 选择 |
|---|---|---|---|---|
| A: 纯 diff | 低 | 快 | 低 | 误报太高 |
| B: diff + 改动文件全文 | **中高** | **中** | **中** | ✅ 选这个 |
| C: 完整克隆 + AST | 高 | 慢 | 高 | 72h 内不现实 |

方案 B 在 72h 时间约束和准确度之间取得了最佳平衡。

### 巨型 PR 的降级策略

| 维度 | 限制 | 行为 |
|---|---|---|
| 改动文件总数 | `max_files=300` | 超出不拉 |
| 进入深审的文件 | `max_deep_files=8` | 按 changes 排序取前 8 |
| PR 描述 | 3K-4K 字符 | 截断 |
| 整体 diff(single 策略) | 60K 字符 | 截断 |
| 单文件内容(deep review) | 30K 字符 | 截断 |

巨型 PR 不会让请求爆 token，优雅降级而非失败。

## 六、未来扩展方向

### 6.1 加入更多模型
- **专家模型**:针对特定语言/框架(Rust / Python 安全等)
- **本地推理**:5090 GPU 上跑本地模型，零延迟 + 零 token 成本
- 只需在 Settings 加字段，reviewer 调用时传 `models=[...]`

### 6.2 上下文获取升级
- **类型推断辅助**:在 deep review 前对改动函数做轻量 LSP 分析，把"这个变量的类型/调用方"塞进 prompt
- **历史 PR 学习**:仓库历史的 review comment 喂给模型当 few-shot
- **依赖图感知**:删除某个公共函数时，自动拉取调用它的所有文件

### 6.3 与 GitHub 深度集成
- **GitHub App**:PR 创建即自动评审，以 review comment 形式回写
- **commit-level 实时反馈**:每个 push 触发增量评审

### 6.4 视觉能力激活
当前视觉模型已接通，激活后可:
- 解析 PR 描述里的架构图截图，理解设计意图
- 对前端 PR 自动跑视觉回归(部署预览 vs 旧版截图)

## 七、Prompt 工程笔记

更深入的 prompt 设计原则、踩过的坑、不同模型差异、未来调优方向 → 见 [docs/prompt-engineering.md](./prompt-engineering.md)。
