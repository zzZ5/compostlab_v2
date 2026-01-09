#!/bin/bash

# 更新前端 API 地址为 CPolar 公网地址
set -e

echo "=== 更新前端 API 地址 ==="

if [ -z "$1" ]; then
    echo "用法: ./update-frontend.sh <cpolar-backend-url>"
    echo "示例: ./update-frontend.sh http://abc123.cpolar.cn"
    exit 1
fi

CPOLAR_URL=$1

# 移除末尾斜杠
CPOLAR_URL=$(echo "$CPOLAR_URL" | sed 's:/*$::')

echo "设置前端 API 地址为: $CPOLAR_URL/api/v2"

# 更新前端环境变量
cat > frontend/.env.production << EOF
NEXT_PUBLIC_API_BASE=$CPOLAR_URL/api/v2
EOF

# 更新后端 CORS 配置（如果需要）
# 注意：这需要修改 settings.py，暂时手动处理

echo "前端环境变量已更新"
echo "重新构建前端..."

# 重新构建前端
docker compose up -d --build frontend

echo "完成！"
echo "前端地址: http://localhost:3000 或前端 CPolar 地址"
echo "后端 API: $CPOLAR_URL/api/v2"
