#!/bin/bash

# 更新前端 API 地址为 CPolar 公网地址
set -e

echo "=== 更新前端 API 地址 ==="

# 使用固定的 CPolar 地址
CPOLAR_BACKEND_URL="http://compostlab-backend-v2.cpolar.cn"

echo "设置前端 API 地址为: $CPOLAR_BACKEND_URL/api/v2"

# 更新前端环境变量
cat > frontend/.env.production << EOF
NEXT_PUBLIC_API_BASE=$CPOLAR_BACKEND_URL/api/v2
EOF

echo "前端环境变量已更新"
echo "API 地址: $CPOLAR_BACKEND_URL/api/v2"
echo ""
echo "重新构建前端..."

# 重新构建前端
docker compose up -d --build frontend

echo "完成！"
echo ""
echo "访问地址："
echo "  前端: http://compostlab-v2.cpolar.cn"
echo "  后端: http://compostlab-backend-v2.cpolar.cn/api/v2"
echo "  Admin: http://compostlab-backend-v2.cpolar.cn/admin"
