#!/bin/bash

# CPolar HTTPS 配置脚本
set -e

echo "=== 配置 CPolar HTTPS 隧道 ==="

# CPolar 配置文件路径
CPOLAR_DIR="/usr/local/etc/cpolar"
CPOLAR_CONF="$CPOLAR_DIR/cpolar.yml"

# 检查是否已登录
if [ ! -f "$CPOLAR_DIR/cpolar.yml" ]; then
    echo "请先登录 cpolar: cpolar authtoken <your-token>"
    exit 1
fi

# 创建支持 HTTPS 的配置文件
sudo tee "$CPOLAR_CONF" > /dev/null << EOF
authtoken: $(grep authtoken "$CPOLAR_DIR/user.yml" | cut -d: -f2 | tr -d ' ')

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

echo "CPolar 配置文件已更新: $CPOLAR_CONF"
echo ""
echo "配置内容："
sudo cat "$CPOLAR_CONF"
echo ""
echo "重启 CPolar 隧道..."

# 重启隧道
cpolar stop-all
sleep 2
cpolar start-all

sleep 3

echo ""
echo "=== 隧道状态 ==="
cpolar status

echo ""
echo "=== 访问地址 ==="
echo "  前端 (HTTPS): https://compostlab-v2.cpolar.cn"
echo "  后端 (HTTPS): https://compostlab-backend-v2.cpolar.cn/api/v2"
echo "  Admin (HTTPS): https://compostlab-backend-v2.cpolar.cn/admin"
