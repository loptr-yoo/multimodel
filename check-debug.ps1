# 项目本地调试检查脚本 (Windows PowerShell)

Write-Host "🔍 开始检查本地调试环境..." -ForegroundColor Cyan
Write-Host ""

# 1. 检查 Node.js
Write-Host "1️⃣  检查 Node.js..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node -v
    Write-Host "✅ Node.js 已安装：$nodeVersion" -ForegroundColor Green
} else {
    Write-Host "❌ 未找到 Node.js，请安装 Node.js >= 16" -ForegroundColor Red
    exit 1
}

# 2. 检查 npm
Write-Host ""
Write-Host "2️⃣  检查 npm..." -ForegroundColor Yellow
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmVersion = npm -v
    Write-Host "✅ npm 已安装：$npmVersion" -ForegroundColor Green
} else {
    Write-Host "❌ 未找到 npm" -ForegroundColor Red
    exit 1
}

# 3. 检查 node_modules
Write-Host ""
Write-Host "3️⃣  检查依赖..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "✅ node_modules 已存在" -ForegroundColor Green
} else {
    Write-Host "⚠️  node_modules 不存在，即将运行 npm install..." -ForegroundColor Yellow
    npm install
}

# 4. 检查 .env.local
Write-Host ""
Write-Host "4️⃣  检查环境配置..." -ForegroundColor Yellow
if (Test-Path ".env.local") {
    $envContent = Get-Content ".env.local"
    if ($envContent -match "VITE_GEMINI_API_KEY") {
        $apiKey = $envContent | Select-String "VITE_GEMINI_API_KEY" | ForEach-Object { $_.Line.Split("=")[1] }
        if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey -eq "your_api_key_here") {
            Write-Host "⚠️  VITE_GEMINI_API_KEY 未配置或为示例值，请编辑 .env.local" -ForegroundColor Yellow
        } else {
            Write-Host "✅ VITE_GEMINI_API_KEY 已配置" -ForegroundColor Green
        }
    } else {
        Write-Host "❌ .env.local 中缺少 VITE_GEMINI_API_KEY" -ForegroundColor Red
    }
} else {
    Write-Host "❌ .env.local 文件不存在，请参考 .env.example" -ForegroundColor Red
    Write-Host "   运行: Copy-Item .env.example .env.local" -ForegroundColor Gray
}

# 5. 检查类型定义
Write-Host ""
Write-Host "5️⃣  检查类型定义..." -ForegroundColor Yellow
if (Test-Path "src/vite-env.d.ts") {
    Write-Host "✅ src/vite-env.d.ts 存在" -ForegroundColor Green
} else {
    Write-Host "⚠️  src/vite-env.d.ts 不存在" -ForegroundColor Yellow
}

# 6. TypeScript 类型检查
Write-Host ""
Write-Host "6️⃣  运行 TypeScript 检查..." -ForegroundColor Yellow
try {
    & npx tsc --noEmit 2>&1 | Select-Object -First 20
} catch {
    Write-Host "⚠️  TypeScript 检查出现错误，但这可能是正常的" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✨ 检查完成！" -ForegroundColor Cyan
Write-Host ""
Write-Host "📌 下一步：" -ForegroundColor Cyan
Write-Host "  1. 确保在 .env.local 中设置了有效的 VITE_GEMINI_API_KEY" -ForegroundColor Gray
Write-Host "  2. 运行 npm run dev 启动开发服务器" -ForegroundColor Gray
Write-Host "  3. 在浏览器中打开 http://localhost:3000" -ForegroundColor Gray
