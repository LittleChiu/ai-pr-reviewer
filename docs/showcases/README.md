# 真实开源 PR 评审 Showcase

> 用本工具评审了 3 个真实公开 PR,展示在不同复杂度场景下的输出质量。
> 每份样例的原始 JSON 见同目录 `*.json`。

## 概览

| 编号 | 仓库 PR | 主题 | 用时 | LLM 调用 | tokens | risks / suggestions |
|---|---|---|---:|---:|---:|---:|
| A | [tiangolo/fastapi#15603](https://github.com/tiangolo/fastapi/pull/15603) | 测试依赖升级 | 11s | 1 | 1,469 | 0 / 0 |
| B | [encode/httpx#3690](https://github.com/encode/httpx/pull/3690) | 新增 .wait_ready() API | 245s | 3 | 7,839 | 6 / 4 |
| C | [encode/httpx#3670](https://github.com/encode/httpx/pull/3670) | FileStream API 重构 | 78s | 3 | 11,522 | 7 / 4 |

## 三档复杂度的不同表现

- **Showcase A**:依赖升级 + lockfile 改动,triage 阶段直接判定全部 skip,1 次 LLM 调用、~1.5K tokens 完成。**这正是节省 token 的关键设计**:lockfile 不该被深审。
- **Showcase B**:中等规模功能新增,深审了 2 个核心文件,识别出 6 处风险(含 high) + 4 条具体建议。
- **Showcase C**:涉及多模块的 API 重构,深审 2 个文件,识别出 7 处风险(含 high) + 4 条建议。

## 复现

```bash
# 启动本地服务后
curl -X POST http://localhost:8000/api/review \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/encode/httpx/pull/3670"}'
```

结果会和本目录下的 JSON 一致(同 commit SHA + 同 prompt + 低 temperature 0.2)。