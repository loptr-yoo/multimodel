#!/bin/bash
# 项目本地调试检查脚本

echo "🔍 开始检查本地调试环境..."
echo ""

# 1. 检查 Node.js
echo "1️⃣  检查 Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js 已安装：$NODE_VERSION"
else
    echo "❌ 未找到 Node.js，请安装 Node.js >= 16"
    exit 1
fi

# 2. 检查 npm
echo ""
echo "2️⃣  检查 npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo "✅ npm 已安装：$NPM_VERSION"
else
    echo "❌ 未找到 npm"
    exit 1
fi

# 3. 检查 node_modules
echo ""
echo "3️⃣  检查依赖..."
if [ -d "node_modules" ]; then
    echo "✅ node_modules 已存在"
else
    echo "⚠️  node_modules 不存在，即将运行 npm install..."
    npm install
fi

# 4. 检查 .env.local
echo ""
echo "4️⃣  检查环境配置..."
if [ -f ".env.local" ]; then
    if grep -q "VITE_GEMINI_API_KEY" .env.local; then
        API_KEY=$(grep VITE_GEMINI_API_KEY .env.local | cut -d'=' -f2)
        if [ -z "$API_KEY" ] || [ "$API_KEY" = "your_api_key_here" ]; then
            echo "⚠️  VITE_GEMINI_API_KEY 未配置，请编辑 .env.local"
        else
            echo "✅ VITE_GEMINI_API_KEY 已配置"
        fi
    else
        echo "❌ .env.local 中缺少 VITE_GEMINI_API_KEY"
    fi
else
    echo "❌ .env.local 文件不存在，请参考 .env.example"
fi

# 5. 检查类型定义
echo ""
echo "5️⃣  检查类型定义..."
if [ -f "src/vite-env.d.ts" ]; then
    echo "✅ src/vite-env.d.ts 存在"
else
    echo "⚠️  src/vite-env.d.ts 不存在"
fi

# 6. TypeScript 类型检查
echo ""
echo "6️⃣  运行 TypeScript 检查..."
npx tsc --noEmit 2>&1 | head -20

echo ""
echo "✨ 检查完成！"
echo ""
echo "📌 下一步："
echo "  1. 确保在 .env.local 中设置了有效的 VITE_GEMINI_API_KEY"
echo "  2. 运行 npm run dev 启动开发服务器"
echo "  3. 在浏览器中打开 http://localhost:3000"
