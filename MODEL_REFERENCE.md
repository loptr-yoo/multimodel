# 🎯 AI 模型快速参考卡片

## 模型对比

| 特性 | Gemini 2.5 Pro | Gemini 3 Preview | DeepSeek Chat | DeepSeek Coder |
|------|-------|--------|--------|--------|
| **提供商** | Google | Google | DeepSeek | DeepSeek |
| **最大 Token** | 100K | 100K | 4K | 4K |
| **输入成本** | $0.0075 | $0.0075 | $0.0014 | $0.0014 |
| **输出成本** | $0.03 | $0.03 | $0.0028 | $0.0028 |
| **推荐用途** | 生产环保 | 测试预览 | 开发测试 | 编码任务 |
| **状态** | ✅ 稳定 | 🧪 预览 | ✅ 稳定 | ✅ 稳定 |

---

## 环境变量配置

### 必需配置

```env
# 至少配置一个 API Key

# Google Gemini
VITE_GEMINI_API_KEY=sk-xxx...

# 或 DeepSeek
VITE_DEEPSEEK_API_KEY=sk-xxx...
```

### 可选配置

```env
# 默认模型（不设置则为 gemini-2.5-pro）
VITE_SELECTED_MODEL=deepseek-chat
```

---

## 核心代码片段

### 读取选中模型

```typescript
import { useStore } from './store';

const { selectedProvider, selectedModel } = useStore();
console.log(`使用 ${selectedModel}（${selectedProvider}）`);
```

### 生成布局

```typescript
import { generateLayout, getApiKeyFromEnv } from './services/aiService';

const apiKey = getApiKeyFromEnv('deepseek');
const layout = await generateLayout(prompt, {
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey,
}, (msg) => console.log(msg));
```

### 创建模型选择器

```typescript
import { ModelSelector } from './components/ModelSelector';

<ModelSelector onClose={() => setShowSelector(false)} />
```

---

## 常用命令

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建
npm run preview

# 检查类型
npx tsc --noEmit
```

---

## API Key 获取链接

- **Gemini:** https://ai.google.dev/
- **DeepSeek:** https://platform.deepseek.com/

---

## 日志示例

### 成功日志

```
使用 deepseek-chat 模型...
[DeepSeek] 正在调用 deepseek-chat 模型...
[DeepSeek] 收到响应 (tokens: 1234)
[DeepSeek] 解析 JSON 响应...
Generation complete.
```

### 错误日志

```
[DeepSeek] 错误: rate_limit
配额不足，细化操作失败。请稍后重试。
```

---

## 文件清单

| 文件 | 用途 | 状态 |
|------|------|------|
| `src/utils/aiConfig.ts` | 模型配置 | ✅ 新增 |
| `src/services/aiService.ts` | 统一接口 | ✅ 新增 |
| `src/services/deepseekService.ts` | DeepSeek 实现 | ✅ 新增 |
| `src/components/ModelSelector.tsx` | 模型选择器 UI | ✅ 新增 |
| `src/App.tsx` | 主应用 | ✅ 已更新 |
| `src/store.ts` | 状态管理 | ✅ 已更新 |
| `.env.local` | 环境配置 | ✅ 已更新 |
| `AI_MODELS_GUIDE.md` | 详细文档 | ✅ 新增 |

---

## 快速问题解决

**Q: 模型选择器不显示？**
A: 检查 .env.local 是否配置了 API Key

**Q: API Key 无效？**
A: 从官网重新生成 API Key，确保复制无空格

**Q: 切换模型后还是用的旧模型？**
A: 刷新浏览器 (F5)

**Q: 如何同时支持多个 Key？**
A: 在 .env.local 中配置所有 Key，UI 中选择切换

---

## 提示和技巧

💡 **成本优化：**
- 开发时用 DeepSeek（便宜）
- 生产用 Gemini（更准确）

💡 **快速测试：**
```
提示词: "simple parking lot"
模型: deepseek-chat
成本: ~¥0.01
```

💡 **批量处理：**
可以在一个 session 中切换模型多次调用

💡 **性能对比：**
- Gemini: 更好的理解能力，响应时间 5-15s
- DeepSeek: 更快的响应，时间 2-8s

---

## 支持的提示词类型

✅ **布局类型描述**
```
"underground parking", "multi-level garage"
```

✅ **尺寸和容量**
```
"800x600 with 100 spaces", "large facility"
```

✅ **特殊要求**
```
"with charging stations", "accessible ramps", "separate exits"
```

✅ **复杂结构**
```
"2 entrance, 3 exits, central island with pillar"
```

---

**最后更新：** 2026-01-29
**版本：** 2.0.0
