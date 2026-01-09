#!/bin/bash

# CPolar HTTPS 手动配置脚本（适用于付费版）
set -e

echo "=== CPolar 付费版 HTTPS 配置（手动） ==="
echo ""

# CPolar 配置文件路径
CPOLAR_DIR="/usr/local/etc/cpolar"
CPOLAR_CONF="$CPOLAR_DIR/cpolar.yml"

echo "1. 检查 CPolar 配置文件..."
if [ ! -f "$CPOLAR_CONF" ]; then
    echo "配置文件不存在，正在创建..."
    TOKEN=$(grep authtoken "$CPOLAR_DIR/user.yml" | cut -d: -f2 | tr -d ' ')

    sudo tee "$CPOLAR_CONF" > /dev/null << EOF
authtoken: $TOKEN
tunnels:
EOF
fi

echo "2. 配置后端 HTTPS 隧道..."
# 添加后端隧道
if ! grep -q "backend:" "$CPOLAR_CONF"; then
    sudo sed -i '/tunnels:/a\  backend:\n    proto: http\n    addr: 8001\n    region: cn\n    subdomain: compostlab-backend-v2' "$CPOLAR_CONF"
fi

echo "3. 配置前端 HTTPS 隧道..."
# 添加前端隧道
if ! grep -q "frontend:" "$CPOLAR_CONF"; then
    sudo sed -i '/backend:/a\  frontend:\n    proto: http\n    addr: 3000\n    region: cn\n    subdomain: compostlab-v2' "$CPOLAR_CONF"
fi

echo ""
echo "4. 显示当前配置..."
sudo cat "$CPOLAR_CONF"

echo ""
echo "5. 重启 CPolar 隧道..."
cpolar stop-all
sleep 2
cpolar start-all

sleep 3

echo ""
echo "=== 隧道状态 ==="
cpolar status

echo ""
echo "=== 完成！==="
echo "请检查上述状态中的 URL 是否为 https:// 开头"
echo "如果是 https://，配置成功！"
echo ""
echo "接下来请运行: ./rebuild-frontend-https.sh"
