#!/bin/bash

# 重启服务脚本
set -e

echo "=== 重启服务 ==="

echo "1. 重启后端服务（应用新的 ALLOWED_HOSTS）..."
docker compose restart backend

echo "2. 等待后端启动..."
sleep 5

echo "3. 重启前端服务..."
docker compose restart frontend

echo ""
echo "服务已重启！"
echo ""
echo "访问地址："
echo "  前端: http://compostlab-v2.cpolar.cn"
echo "  后端: http://compostlab-backend-v2.cpolar.cn/api/v2"
echo "  Admin: http://compostlab-backend-v2.cpolar.cn/admin"
