#!/usr/bin/env bash
# ==========================================
# InkMind 一键启动脚本
# ==========================================
# 使用方法：
#   1. 确保已激活 Python 虚拟环境（如 conda 或 venv）
#   2. 运行此脚本：./start-dev.sh
#
# 自定义端口（可选）：
#   VITE_FRONTEND_PORT=3000 VITE_BACKEND_PORT=8001 ./start-dev.sh
# ==========================================

set -e

# 默认端口配置
FRONTEND_PORT=${VITE_FRONTEND_PORT:-5173}
BACKEND_PORT=${VITE_BACKEND_PORT:-8000}

echo "=========================================="
echo "  InkMind 开发环境启动"
echo "=========================================="
echo ""
echo "前端端口: $FRONTEND_PORT"
echo "后端端口: $BACKEND_PORT"
echo ""

# 检查后端目录
if [ ! -d "backend" ]; then
    echo "错误: 找不到 backend 目录，请确保在项目根目录运行此脚本"
    exit 1
fi

# 检查前端目录
if [ ! -d "frontend" ]; then
    echo "错误: 找不到 frontend 目录，请确保在项目根目录运行此脚本"
    exit 1
fi

# 检查 Python 环境（可选提示）
if ! python -c "import uvicorn" 2>/dev/null; then
    echo "警告: uvicorn 未安装，请确保已激活 Python 虚拟环境"
    echo "提示: 尝试运行 'conda activate your_env' 或 'source venv/bin/activate'"
    echo ""
fi

# 检查 Node.js 环境
if ! node -v >/dev/null 2>&1; then
    echo "错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "正在启动服务..."
echo ""
echo "=========================================="
echo "  访问地址"
echo "=========================================="
echo "前端: http://localhost:$FRONTEND_PORT"
echo "后端: http://localhost:$BACKEND_PORT (健康检查: http://localhost:$BACKEND_PORT/health)"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo "=========================================="
echo ""

# 导出环境变量
export VITE_FRONTEND_PORT=$FRONTEND_PORT
export VITE_BACKEND_PORT=$BACKEND_PORT

# 切换到 frontend 目录并运行 concurrently
cd frontend

# 使用 concurrently 同时启动前后端
# 注意：后端命令假设用户已在 shell 中激活了 Python 环境
npx concurrently \
    --names "backend,frontend" \
    --prefix-colors "yellow,green" \
    --kill-others \
    "cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port $BACKEND_PORT --reload" \
    "npm run dev"
