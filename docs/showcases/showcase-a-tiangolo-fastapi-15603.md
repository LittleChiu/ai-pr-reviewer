# Showcase A: tiangolo/fastapi#15603

**PR**: [https://github.com/tiangolo/fastapi/pull/15603](https://github.com/tiangolo/fastapi/pull/15603)
**主题**: 测试依赖升级
**为什么选**: 演示 triage 阶段对 lockfile/依赖性变更的'整体跳过'能力

## 评审输出

- **模型**: `deepseek-v4-pro-max`
- **用时**: 11.0 s
- **LLM 调用次数**: 1
- **Token 消耗**: 573 prompt + 896 completion = **1,469** total

### 📋 总结

此 PR 旨在修复 CI 因 starlette 引入的弃用警告而失败的问题。通过将测试依赖 `httpx` 替换为 `httpx2`，并更新相关测试文件中的导入和使用方式，确保测试在新依赖下正常运行。改动涉及 CI 工作流配置文件、项目依赖定义、两个测试文件以及自动生成的锁文件，整体属于一次小范围的依赖与测试兼容性更新。
