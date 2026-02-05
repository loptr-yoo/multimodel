# 🤖 多 AI 模型支持使用指南

## 功能概述

项目现已支持多个 AI 提供商和模型：

### 支持的提供商

#### 1. **Google Gemini**
- 最新的多模态 AI 模型
- 支持复杂的推理和空间分析任务
- 适合停车场布局设计

**可用模型：**
- `gemini-2.5-pro` - Gemini 2.5 Pro（推荐）
- `gemini-3-pro-preview` - Gemini 3 Pro Preview

**成本：** $0.0075/1k 输入 token，$0.03/1k 输出 token

#### 2. **DeepSeek** (新增)
- 开源 AI 模型
- 成本低廉
- 响应速度快

**可用模型：**
- `deepseek-chat` - DeepSeek Chat（推荐）
- `deepseek-coder` - DeepSeek Coder（编程任务）

**成本：** $0.0014/1k 输入 token，$0.0028/1k 输出 token

---

## 快速开始

### 1. 配置 API Keys

编辑 `.env.local` 文件添加你的 API Keys：

```env
# Gemini API Key (可选，不配置则自动跳过 Gemini)
VITE_GEMINI_API_KEY=your_actual_gemini_key_here

# DeepSeek API Key (可选，不配置则自动跳过 DeepSeek)
VITE_DEEPSEEK_API_KEY=your_actual_deepseek_key_here

# 默认模型选择 (可选，默认为 gemini-2.5-pro)
VITE_SELECTED_MODEL=gemini-2.5-pro
```

### 2. 启动应用

```bash
npm run dev
```

访问 http://localhost:3001

### 3. 在 UI 中切换模型

点击右侧控制面板顶部的 **"✨ 模型选择"** 按钮打开模型选择器。

---

## 获取 API Keys

### Google Gemini

1. 访问 [Google AI Studio](https://ai.google.dev/)
2. 点击 "Get API Key"
3. 创建新的 API Key
4. 复制密钥到 `.env.local`

### DeepSeek

1. 访问 [DeepSeek 平台](https://platform.deepseek.com/)
2. 注册账号
3. 创建 API Key
4. 复制密钥到 `.env.local`

---

## 使用模型选择器

### UI 界面

**位置：** 右侧控制面板顶部

**功能：**
1. 点击 **"✨"** 按钮打开模型选择器
2. 选择提供商标签页（**Gemini** 或 **DeepSeek**）
3. 选择想要的模型
4. 点击 **"关闭"** 或直接选择模型后自动关闭

**显示信息：**
- 模型名称
- 模型描述
- 价格信息（输入/输出成本）
- 当前选择的模型高亮显示

### 代码中使用

```typescript
import { useStore } from './store';

const MyComponent = () => {
  const { selectedProvider, selectedModel, setSelectedProvider, setSelectedModel } = useStore();
  
  // 读取当前选择
  console.log(`当前模型: ${selectedModel} (${selectedProvider})`);
  
  // 切换模型
  setSelectedProvider('deepseek');
  setSelectedModel('deepseek-chat');
};
```

---

## 工作流程

### 使用 Gemini 生成布局

```
1. 配置 VITE_GEMINI_API_KEY 到 .env.local
2. 在模型选择器中选择 Gemini 模型
3. 输入停车场设计提示词
4. 点击 "Generate Layout" 生成布局
```

### 使用 DeepSeek 生成布局

```
1. 配置 VITE_DEEPSEEK_API_KEY 到 .env.local
2. 在模型选择器中选择 DeepSeek 模型
3. 输入停车场设计提示词
4. 点击 "Generate Layout" 生成布局
```

### 支持的功能

- ✅ 生成停车场布局（Generate Layout）
- ✅ 细化布局添加道路和标志（Smart Refinement）
- ✅ 下载为 JPG 格式（Download）
- ✅ 实时日志显示（Logs）
- ✅ 错误处理和提示

---

## 提示词示例

### 基础停车场
```
Simple parking lot with 3 rows of parking spaces and 2 entrance areas
```

### 复杂停车场
```
Underground parking structure:
- 2 main lanes for traffic
- 4 entrance/exit points
- Central islands with pillars
- Designated charging stations
- Ground level only
```

### 多层停车场
```
Multi-level parking garage:
- Level 1: 50 spaces, 1 entrance
- Level 2: 50 spaces, disabled access ramp
- Staircase in center
- Elevator near entrance
```

---

## 错误处理

### "No API Key configured"

**原因：** 选择的模型提供商的 API Key 未配置

**解决：**
1. 编辑 `.env.local` 添加相应的 API Key
2. 重启开发服务器
3. 重新选择模型

### "API 配额已耗尽（HTTP 429）"

**原因：** 达到 API 配额限制

**解决：**
1. 等待一段时间后重试
2. 如果使用免费配额，考虑升级到付费计划
3. 切换到其他提供商的模型

### "Model not found"

**原因：** 指定的模型不存在

**解决：**
1. 检查模型 ID 是否正确
2. 选择支持的模型之一
3. 更新环境变量

---

## 高级配置

### 环境变量参考

```typescript
// src/utils/aiConfig.ts 中定义

// API Key 对应的环境变量
ENV_KEYS.GEMINI_API_KEY = 'VITE_GEMINI_API_KEY'
ENV_KEYS.DEEPSEEK_API_KEY = 'VITE_DEEPSEEK_API_KEY'
ENV_KEYS.SELECTED_MODEL = 'VITE_SELECTED_MODEL'
```

### 添加新的模型提供商

1. 在 `src/utils/aiConfig.ts` 中添加新提供商：

```typescript
export type AIProvider = 'gemini' | 'deepseek' | 'your_new_provider';

export const AVAILABLE_MODELS: AIModel[] = [
  // ... existing models
  {
    id: 'your-model',
    name: 'Your Model Name',
    provider: 'your_new_provider',
    description: '...',
    maxTokens: 4096,
    costPer1kTokens: { input: 0.001, output: 0.002 },
  },
];
```

2. 在 `src/services/aiService.ts` 中添加对应的处理逻辑：

```typescript
case 'your_new_provider':
  return await yourNewProviderFunction(...);
```

3. 创建服务模块（如 `src/services/yourProviderService.ts`）

---

## 最佳实践

### 1. API Key 安全

✅ **推荐：**
- 使用 `.env.local` 管理 API Keys
- 从不将 `.env.local` 提交到 Git
- 使用环境变量注入

❌ **不推荐：**
- 硬编码 API Keys
- 在代码中明文存储密钥
- 提交敏感信息到版本控制

### 2. 成本优化

选择合适的模型平衡成本和性能：

| 用途 | 推荐模型 | 原因 |
|------|--------|------|
| 生产环境 | Gemini 2.5 Pro | 准确度高 |
| 开发测试 | DeepSeek Chat | 成本低 |
| 编码任务 | DeepSeek Coder | 专用模型 |

### 3. 错误处理

```typescript
try {
  const layout = await generateLayout(prompt, {
    provider: selectedProvider,
    model: selectedModel,
    apiKey,
  }, onProgress);
} catch (error) {
  if (error.message.includes('rate_limit')) {
    // 处理速率限制
  } else if (error.message.includes('invalid_api_key')) {
    // 处理 Key 问题
  }
}
```

---

## 故障排除

### 模型选择器不显示

**检查项：**
1. 确保 `.env.local` 中至少配置了一个 API Key
2. 检查浏览器控制台是否有错误
3. 重新启动开发服务器

### 生成失败

**检查项：**
1. 检查日志面板中的错误信息
2. 验证 API Key 是否有效
3. 检查网络连接
4. 查看 API 提供商的状态页面

### 模型切换不起作用

**检查项：**
1. 刷新浏览器
2. 检查 localStorage（F12 > Application > Local Storage）
3. 清除浏览器缓存
4. 重启开发服务器

---

## 开发者指南

### 项目结构

```
src/
├── services/
│   ├── aiService.ts           # 统一 AI 服务接口
│   ├── geminiService.ts       # Gemini 实现
│   └── deepseekService.ts     # DeepSeek 实现（新）
├── components/
│   └── ModelSelector.tsx       # 模型选择 UI 组件（新）
├── utils/
│   └── aiConfig.ts           # 模型配置（新）
└── store.ts                   # 状态管理（已更新）
```

### 添加新功能

1. **添加新的 API 提供商：**
   - 创建 `src/services/yourService.ts`
   - 在 `aiService.ts` 中集成

2. **扩展模型列表：**
   - 更新 `aiConfig.ts` 中的 `AVAILABLE_MODELS`

3. **自定义 UI：**
   - 修改 `ModelSelector.tsx`

---

## 更新日志

### v2.0.0 (2026-01-29)

✨ **新增功能：**
- 支持 DeepSeek 模型
- 模型选择 UI 组件
- 统一的 AI 服务接口
- 多提供商支持

🔧 **改进：**
- 更灵活的 API 密钥管理
- 更好的错误处理
- 实时日志显示

📚 **文档：**
- 完整的使用指南
- API 文档
- 故障排除指南

---

## 联系与支持

- 📖 查看 [QUICK_START.md](./QUICK_START.md) 快速开始
- 🐛 遇到问题？检查 [DEBUG_GUIDE.md](./DEBUG_GUIDE.md)
- 💡 有建议？欢迎反馈

**Happy coding! 🚀**
