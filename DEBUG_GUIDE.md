# 🚀 本地调试指南

## 快速开始

### 1️⃣ 安装依赖
```bash
npm install
```

### 2️⃣ 配置 API Key
编辑 `.env.local` 文件，添加您的 Gemini API Key：
```
VITE_GEMINI_API_KEY=your_actual_api_key_here
```

**如何获取 API Key：**
- 访问 [Google AI Studio](https://ai.google.dev/)
- 创建新的 API Key
- 复制到 `.env.local`

### 3️⃣ 启动开发服务器
```bash
npm run dev
```

服务器将在 `http://localhost:3000` 启动

---

## 📊 项目结构

```
├── components/          # React 组件
│   ├── MapRenderer.tsx  # 停车场地图渲染 (D3.js)
│   └── LayoutControl.tsx # 布局控制面板
├── services/
│   └── geminiService.ts # Gemini API 集成
├── utils/
│   ├── geometry.ts      # 几何验证工具
│   ├── parsers.ts       # JSON 解析工具
│   └── prompts.ts       # AI 提示词
├── store.ts             # Zustand 状态管理
├── types.ts             # TypeScript 类型定义
└── vite.config.ts       # Vite 构建配置
```

---

## 🔧 调试建议

### VS Code 扩展推荐
```json
推荐安装：
- ES7+ React/Redux/React-Native snippets
- Prettier - Code formatter
- TypeScript Vue Plugin (Volar)
```

### 环境检查清单
- [x] Node.js >= 16
- [x] npm >= 8
- [x] `.env.local` 已创建并配置
- [x] `npm install` 已执行
- [x] TypeScript 类型已生成

### 常见问题排查

#### 问题 1：找不到模块 "react"
```
解决方案：
1. 删除 node_modules 和 package-lock.json
2. 运行 npm install
3. 重启 VS Code
```

#### 问题 2：`window.aistudio` 类型错误
```
✅ 已通过 src/vite-env.d.ts 解决
```

#### 问题 3：API Key 无效
```
检查：
1. .env.local 中的 VITE_GEMINI_API_KEY 是否正确
2. API Key 是否已过期
3. 项目是否有配额限制
```

---

## 🏗️ 构建和部署

### 开发构建
```bash
npm run dev
```

### 生产构建
```bash
npm run build
```

### 预览生产版本
```bash
npm run preview
```

---

## 🐛 调试技巧

### 1. 查看日志
应用会在左侧面板显示实时日志，包括：
- AI 生成过程
- 验证错误
- API 调用状态

### 2. 浏览器 DevTools
```
F12 打开开发者工具
- Console: 查看 JavaScript 错误
- Network: 监控 API 请求
- Application: 检查存储状态
```

### 3. 类型检查
```bash
# 检查 TypeScript 编译错误
npx tsc --noEmit
```

---

## 📋 已修复的问题

1. ✅ 环境变量配置 - 改用 `VITE_` 前缀
2. ✅ 类型定义 - 新增 `src/vite-env.d.ts`
3. ✅ API Key 获取 - 支持 `import.meta.env`
4. ✅ tsconfig 配置 - 添加必要的类型和包含路径
5. ✅ VS Code 设置 - 创建工作区配置

---

## 💡 性能优化建议

### 当前状态
- D3.js 用于地图渲染 ✓
- Zustand 用于状态管理 ✓
- React 19.2.3 最新版本 ✓

### 建议改进
1. 添加 React.memo 避免不必要重渲染
2. 为大型列表使用虚拟化
3. 添加错误边界 (Error Boundary)
4. 实现路由懒加载

---

## 📞 获取帮助

- 官方文档：https://ai.google.dev/
- Vite 文档：https://vitejs.dev/
- React 文档：https://react.dev/
