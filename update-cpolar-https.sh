#!/bin/bash

# CPolar HTTPS 配置脚本
set -e

echo "=== 配置 CPolar HTTPS 隧道 ==="

# 检查是否已登录
if [ ! -f ~/.cpolar/user.yml ]; then
    echo "请先登录 cpolar: cpolar authtoken <your-token>"
    exit 1
fi

# 创建支持 HTTPS 的配置文件
cat > ~/.cpolar/cpolar.yml << EOF
authtoken: $(grep authtoken ~/.cpolar/user.yml | cut -d: -f2 | tr -d ' ')

tunnels:
  # 后端 API 隧道（HTTPS）
  backend:
    proto: http
    addr: 8001
    region: cn
    subdomain: compostlab-backend-v2
    # 启用 HTTPS（付费版功能）
    cpolar_https: true

  # 前端隧道（HTTPS）
  frontend:
    proto: http
    addr: 3000
    region: cn
    subdomain: compostlab-v2
    # 启用 HTTPS（付费版功能）
    cpolar_https: true
EOF

echo "CPolar 配置文件已更新，已启用 HTTPS"
echo ""
echo "配置内容："
cat ~/.cpolar/cpolar.yml
echo ""
echo "重启 CPolar 隧道..."

# 重启隧道
cpolar stop-all
sleep 2
cpolar start-all

sleep 3

echo ""
echo "=== 隧道状态 ==="
cpolar status | grep -E "URL|tcp|https"

echo ""
echo "=== 访问地址 ==="
echo "  前端 (HTTPS): https://compostlab-v2.cpolar.cn"
echo "  后端 (HTTPS): https://compostlab-backend-v2.cpolar.cn/api/v2"
echo "  Admin (HTTPS): https://compostlab-backend-v2.cpolar.cn/admin"
