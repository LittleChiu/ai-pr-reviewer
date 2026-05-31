# Prompt 工程笔记

> 这份文档记录我们在设计评审 system prompt 时做的关键选择、踩过的坑、以及对未来调优的建议。

## 一、核心 prompt 设计原则

### 1.1 强制 JSON 输出
**为什么**:LLM 自由发挥的 markdown 文本无法直接喂给前端,且容易"飘"(说一堆与任务无关的客套话)。
**怎么做**:system prompt 末尾加 `输出**严格 JSON**(不要 markdown 包裹,不要前后缀)`,并在文档中给完整的 schema 示例。
**实测效果**:DeepSeek V4 / Claude 4.6 / Gemini 3.1 都能稳定遵守 ~95% 时间。剩余 5% 用 [`extract_json` 二次容错](../backend/app/services/llm_client.py)兜底(去控制字符 + 替换中文引号)。

### 1.2 明确角色与原则
**为什么**:不强约束的话,LLM 会输出大量"建议优化"、"考虑使用"这种空泛的话。
**怎么做**:system prompt 开头明确身份(`你是一位资深的代码评审专家`)+ 4 条原则:
1. 忠于事实,只对 diff 中实际出现的代码发表意见
2. 关注真正影响正确性、性能、安全性的问题;风格 nitpick 归到次要建议
3. 每条问题/建议都要标注严重程度与置信度
4. 用人话说话,避免空泛的"建议优化"

**实测效果**:第 1 条最有效,直接降低了模型"臆造代码"的概率。第 4 条对 Claude 影响最大,DeepSeek 本来就很务实。

### 1.3 严重程度 + 置信度三级体系
**为什么**:reviewer 看评审结果时最希望"哪些必须看 / 哪些可看可不看 / 哪些可以忽略"。
**怎么做**:每条 risk/suggestion 带 `severity (high/medium/low)` + `confidence (high/medium/low)`,前端按 severity 排序、按 confidence 着色淡化。

**关键决策**:不要让模型自己设计严重程度的标签,而是**枚举固定值**让它选。如果只说"指出问题的严重程度",模型会用各种自创词(critical / major / minor / nitpick / trivial...),前端就要写一堆 mapping 适配。

### 1.4 强制 line_hint
**为什么**:reviewer 必须能立即定位到代码,否则评审结果是空话。
**怎么做**:schema 里 `line_hint` 设为可选(因为某些建议确实是文件级的),但 prompt 强调"尽量给行号或行号范围"。
**结果**:实测 90% 的 risk 都带具体行号或范围。

## 二、踩过的坑

### 坑 1:让模型"找出所有问题"

最初我们用 `指出所有可能的问题`,结果模型每次输出 10+ 条 risk,大部分是 nitpick。

**修正**:改成 `质量比数量重要。如果 PR 看起来质量很高,risks/suggestions 可以为空数组`。
明确告诉模型"宁缺毋滥",输出立刻精准了一倍。

### 坑 2:跨文件深审里的"文件全文"喂得太多

第二层(深审)我们把改动文件**变更后的完整内容**给模型,但有些文件 1000+ 行,token 爆炸。

**修正**:加 `char_limit=30000` 截断,长文件先截断再给。同时在 prompt 里说"如果内容已截断,优先关注上半部分"。
**反思**:更优解应该是只给"diff 上下 30 行的窗口"而不是完整文件。但实现上更复杂,留作未来优化。

### 坑 3:LLM 输出含中文智能引号

不止一次遇到 Gemini 3.1 输出 `"summary": "用了"小变量"包装"` 这种中文引号嵌套的 JSON,直接 `json.loads` 失败。

**修正**:[`_clean_json_like`](../backend/app/services/llm_client.py) 二次容错,失败后自动替换 `""''` → `""''` 再试。
也支持去控制字符(LLM 输出偶尔夹杂 `\x00-\x1f`)。

### 坑 4:粗筛模型把所有文件标 "deep"

第一层粗筛我们用 fast 模型(deepseek-v4-flash),最初只说"判断每个文件值不值得深审",结果模型保险起见把 80% 文件都标 deep,失去粗筛意义。

**修正**:在 prompt 里**枚举具体跳过场景**:`"skip": 自动生成 / lockfile / 大段格式化 / 纯文档`。
立刻见效,Showcase A(fastapi 测试依赖更新)6 个文件全 skip,1 次 LLM 调用搞定。

### 坑 5:深审 prompt 让模型重复 PR 描述

最初模型在 risk 详情里经常重复 "本 PR 修改了 X 来实现 Y...",废话连篇。

**修正**:在 system prompt 加 `summary 中不要复述变更行数,关注'为什么这么改'。不要重复 PR 描述里已经说过的内容`。
输出立刻聚焦了。

## 三、不同模型的差异(实测观察)

| 维度 | DeepSeek V4 Pro Max | Gemini 3.1 Flash Lite |
|---|---|---|---|
| JSON 遵守度 | ★★★★☆ | ★★★★ |
| 务实程度 | ★★★★★ | ★★★★ |
| 中文流畅度 | ★★★★★ | ★★★★ |
| 速度(单文件深审) | 8-15s | 3-6s |
| 价格(粗略) | ¥0.5/M tokens | $0.075/M tokens |
| 用途 | **PRIMARY**(粗筛+深审) | **VISION**(多模态) |

DeepSeek 是当前最优"性价比 + 中文 + 务实",所以默认 PRIMARY。

## 四、未来调优方向

### 4.1 few-shot 学习仓库的评审风格
在 prompt 末尾附加 `## 这个仓库历史 review 的风格示例`,从仓库的过往 PR review comments 里抽 3-5 条作为 few-shot,让模型按这个团队的口吻评审。
预期效果:同样的 risk 用团队习惯的术语表达,显著提升 reviewer 接受度。

### 4.2 按文件类型动态调整 prompt
- `*.test.py` / `*.spec.ts` → 关注测试覆盖、断言强度
- `*.config.*` → 关注默认值、向后兼容
- `Dockerfile` / `*.yml` → 关注安全(暴露密钥、特权模式)、镜像大小

当前是统一一套 prompt,未来可基于文件路径选不同的 system prompt。

### 4.3 增量评审(diff-only 的 fast path)
现状:即使是 +5 行的小 PR,也会跑完整三层。
优化:对 < 50 行变更的 PR,跳过粗筛,直接 single-pass 评审,目标响应 < 10s。

### 4.4 评审结果的"自我审查"层
加一个第四层:用另一个模型审查上层的输出,把空泛 / 重复 / 误报标记的建议过滤掉。代价是多一次 LLM 调用,但可显著降低噪声。

### 4.5 多语言代码的 prompt 国际化
当前 prompt 是中文,模型回复也是中文。如果用户的代码库主要是英文(开源项目),中文 review 反而不友好。
方案:根据 PR 描述语言或 GitHub repo language 自动选 prompt 语言。

## 五、复现实验

要对比不同 prompt 版本的实际效果差异,可以:

```bash
# 1. 起后端 + 用 single 策略(避免分层引入额外变量)
PRIMARY_MODEL=deepseek-v4-flash uv run uvicorn app.main:app

# 2. 用同一个 PR 反复跑,改 prompt 后清缓存
curl -X POST localhost:8000/api/review \
  -H "Content-Type: application/json" \
  -d '{"url":"<PR_URL>","strategy":"single","force_refresh":true}' \
  | jq '.risks | length, .suggestions | length'

# 3. 对比 risk 数量、severity 分布、内容质量
```

prompt 实验最值钱的是**保留对照组**:同一个 PR、同一个模型、不同 prompt,把输出存档对比。我们的 [docs/showcases/](./showcases/) 里就有"基线版"输出,任何修改都能跟它对照。
