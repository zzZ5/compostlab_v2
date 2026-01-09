#!/bin/bash

# 重新构建前端脚本
set -e

echo "=== 重新构建前端 ==="

echo "1. 检查前端环境变量..."
if [ ! -f frontend/.env.production ]; then
    echo "错误: frontend/.env.production 文件不存在"
    exit 1
fi

echo "前端 API 地址配置:"
cat frontend/.env.production

echo ""
echo "2. 停止并删除前端容器..."
docker compose stop frontend
docker compose rm -f frontend

echo ""
echo "3. 重新构建前端镜像（使用新的环境变量）..."
docker compose build --no-cache frontend

echo ""
echo "4. 启动前端服务..."
docker compose up -d frontend

echo ""
echo "5. 等待前端启动..."
sleep 5

echo ""
echo "6. 验证前端环境变量..."
docker compose exec frontend env | grep NEXT_PUBLIC_API_BASE

echo ""
echo "=== 重新构建完成！==="
echo ""
echo "访问地址："
echo "  前端: http://compostlab-v2.cpolar.cn"
echo "  后端: http://compostlab-backend-v2.cpolar.cn/api/v2"
echo "  Admin: http://compostlab-backend-v2.cpolar.cn/admin"
