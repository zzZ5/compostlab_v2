#!/bin/bash

# CPolar 部署脚本
set -e

echo "=== CPolar 部署脚本 ==="

# 1. 检查 cpolar 是否安装
if ! command -v cpolar &> /dev/null; then
    echo "正在安装 cpolar..."
    curl -L https://www.cpolar.com/static/downloads/install-release-cpolar.sh | sudo bash
    echo "cpolar 安装完成"
else
    echo "cpolar 已安装"
fi

# 2. 检查是否已登录
if [ ! -f ~/.cpolar/user.yml ]; then
    echo "请先登录 cpolar"
    echo "1. 访问 https://dashboard.cpolar.com/ 注册账号"
    echo "2. 获取 Authtoken"
    echo "3. 运行: cpolar authtoken <your-token>"
    exit 1
fi

# 3. 创建 cpolar 配置目录
mkdir -p ~/.cpolar

# 4. 创建配置文件（使用固定域名）
cat > ~/.cpolar/cpolar.yml << EOF
authtoken: $(grep authtoken ~/.cpolar/user.yml | cut -d: -f2 | tr -d ' ')

tunnels:
  # 后端 API 隧道
  backend:
    proto: http
    addr: 8001
    region: cn
    subdomain: compostlab-backend-v2
    
  # 前端隧道
  frontend:
    proto: http
    addr: 3000
    region: cn
    subdomain: compostlab-v2
EOF

echo "CPolar 配置文件已创建"
echo "后端域名: compostlab-backend-v2.cpolar.cn"
echo "前端域名: compostlab-v2.cpolar.cn"

# 5. 停止现有服务
echo "停止现有服务..."
docker compose down

# 6. 启动 Docker 服务
echo "启动 Docker 服务..."
docker compose up -d

# 7. 等待服务启动
echo "等待服务启动..."
sleep 10

# 8. 启动 CPolar 隧道
echo "启动 CPolar 隧道..."
cpolar start-all

# 9. 获取公网地址
echo ""
echo "=== 部署完成！==="
echo ""
echo "服务状态："
docker compose ps
echo ""
echo "CPolar 隧道地址："
sleep 3
cpolar status | grep -E "URL|tcp"
echo ""
echo "访问地址："
echo "  前端: http://compostlab-v2.cpolar.cn"
echo "  后端: http://compostlab-backend-v2.cpolar.cn/api/v2"
echo "  Admin: http://compostlab-backend-v2.cpolar.cn/admin"
