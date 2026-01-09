#!/bin/bash

# CompostLab CPolar HTTPS 部署脚本（整合版）
set -e

echo "=========================================="
echo "  CompostLab CPolar HTTPS 部署工具"
echo "=========================================="
echo ""

# 配置文件路径
CPOLAR_CONF="/usr/local/etc/cpolar/cpolar.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 帮助信息
show_help() {
    cat << EOF
用法: ./deploy.sh [选项]

选项:
  install     - 首次部署（安装依赖、配置 CPolar、启动服务）
  config      - 仅配置 CPolar HTTPS 隧道
  build       - 仅重新构建前端（使用 HTTPS）
  restart     - 重启 Docker 服务
  status      - 查看服务状态
  help        - 显示此帮助信息

示例:
  ./deploy.sh install      # 首次部署
  ./deploy.sh config       # 更新 CPolar 配置
  ./deploy.sh build        # 重建前端
  ./deploy.sh restart      # 重启服务
EOF
}

# 检查 CPolar 是否安装
check_cpolar() {
    echo -e "${YELLOW}检查 CPolar...${NC}"
    if ! command -v cpolar &> /dev/null; then
        echo -e "${RED}CPolar 未安装，正在安装...${NC}"
        curl -L https://www.cpolar.com/static/downloads/install-release-cpolar.sh | sudo bash
        echo -e "${GREEN}CPolar 安装完成${NC}"
    else
        echo -e "${GREEN}CPolar 已安装${NC}"
    fi
    echo ""
}

# 检查 CPolar 是否登录
check_cpolar_login() {
    echo -e "${YELLOW}检查 CPolar 登录状态...${NC}"
    if [ ! -f "$CPOLAR_CONF" ]; then
        echo -e "${RED}未登录 CPolar！${NC}"
        echo ""
        echo "请先登录："
        echo "  1. 访问 https://dashboard.cpolar.com/ 注册账号"
        echo "  2. 获取 Authtoken"
        echo "  3. 运行: cpolar authtoken <your-token>"
        echo ""
        exit 1
    fi
    echo -e "${GREEN}已登录 CPolar${NC}"
    echo ""
}

# 配置 CPolar HTTPS 隧道
config_cpolar() {
    echo -e "${YELLOW}配置 CPolar HTTPS 隧道...${NC}"

    # 获取当前的 authtoken（从 cpolar.yml 中提取）
    TOKEN=$(grep "^authtoken:" "$CPOLAR_CONF" 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")

    # 如果配置文件不存在，创建基础配置
    if [ ! -f "$CPOLAR_CONF" ]; then
        echo "配置文件不存在，请先运行: cpolar authtoken <your-token>"
        exit 1
    fi

    # 检查是否已配置隧道
    if grep -q "backend:" "$CPOLAR_CONF" && grep -q "frontend:" "$CPOLAR_CONF"; then
        echo -e "${YELLOW}CPolar 隧道已配置${NC}"
        read -p "是否要重新配置? (y/N): " confirm
        if [[ ! $confirm =~ ^[Yy]$ ]]; then
            return
        fi
    fi

    # 创建新的配置文件（备份旧配置）
    sudo cp "$CPOLAR_CONF" "$CPOLAR_CONF.bak.$(date +%Y%m%d_%H%M%S)"

    # 写入配置
    sudo tee "$CPOLAR_CONF" > /dev/null << EOF
authtoken: $TOKEN

tunnels:
  # 后端 API 隧道（HTTPS）
  backend:
    proto: http
    addr: 8001
    region: cn
    subdomain: compostlab-backend-v2

  # 前端隧道（HTTPS）
  frontend:
    proto: http
    addr: 3000
    region: cn
    subdomain: compostlab-v2
EOF

    echo -e "${GREEN}CPolar 配置已更新${NC}"
    echo ""
    echo "配置内容："
    sudo cat "$CPOLAR_CONF"
    echo ""

    # 重启 CPolar 隧道
    echo -e "${YELLOW}重启 CPolar 隧道...${NC}"
    cpolar stop-all
    sleep 2
    cpolar start-all
    sleep 3

    # 显示状态
    echo ""
    echo "=== CPolar 隧道状态 ==="
    cpolar status
    echo ""

    # 检查是否启用 HTTPS
    if cpolar status | grep -q "https://"; then
        echo -e "${GREEN}✓ HTTPS 已启用${NC}"
    else
        echo -e "${RED}✗ HTTPS 未启用（请检查 CPolar 付费套餐）${NC}"
    fi
    echo ""
}

# 部署 Docker 服务
deploy_docker() {
    echo -e "${YELLOW}部署 Docker 服务...${NC}"

    # 检查 docker-compose.yml
    if [ ! -f "docker-compose.yml" ]; then
        echo -e "${RED}错误: 找不到 docker-compose.yml${NC}"
        exit 1
    fi

    # 停止现有服务
    echo "停止现有服务..."
    docker compose down

    # 启动服务
    echo "启动服务..."
    docker compose up -d

    # 等待服务启动
    echo "等待服务启动..."
    sleep 10

    # 检查服务状态
    echo ""
    echo "=== Docker 服务状态 ==="
    docker compose ps
    echo ""

    # 执行数据库迁移
    echo -e "${YELLOW}执行数据库迁移...${NC}"
    docker compose exec -T backend python manage.py migrate --noinput || true
    echo -e "${GREEN}数据库迁移完成${NC}"
    echo ""
}

# 重新构建前端
rebuild_frontend() {
    echo -e "${YELLOW}重新构建前端（使用 HTTPS）...${NC}"

    # 检查前端环境变量
    if [ ! -f "frontend/.env.production" ]; then
        echo -e "${RED}错误: 找不到 frontend/.env.production${NC}"
        exit 1
    fi

    echo "前端 API 地址："
    cat frontend/.env.production
    echo ""

    # 停止并删除前端容器
    echo "停止前端容器..."
    docker compose stop frontend
    docker compose rm -f frontend

    # 重新构建前端
    echo "重新构建前端镜像..."
    docker compose build --no-cache frontend

    # 启动前端
    echo "启动前端服务..."
    docker compose up -d frontend

    # 等待启动
    sleep 5

    # 验证环境变量
    echo ""
    echo "=== 前端环境变量 ==="
    docker compose exec frontend env | grep NEXT_PUBLIC_API_BASE
    echo ""

    echo -e "${GREEN}前端重新构建完成${NC}"
    echo ""
}

# 重启服务
restart_services() {
    echo -e "${YELLOW}重启 Docker 服务...${NC}"
    docker compose restart
    sleep 5
    echo -e "${GREEN}服务已重启${NC}"
    echo ""
}

# 查看状态
show_status() {
    echo "=== Docker 服务状态 ==="
    docker compose ps
    echo ""

    echo "=== CPolar 隧道状态 ==="
    cpolar status
    echo ""

    echo "=== 访问地址 ==="
    echo -e "  前端: ${GREEN}https://compostlab-v2.cpolar.cn${NC}"
    echo -e "  后端: ${GREEN}https://compostlab-backend-v2.cpolar.cn/api/v2${NC}"
    echo -e "  Admin: ${GREEN}https://compostlab-backend-v2.cpolar.cn/admin${NC}"
    echo ""
}

# 主函数
main() {
    cd "$SCRIPT_DIR" || exit 1

    case "${1:-}" in
        install)
            echo -e "${GREEN}首次部署模式${NC}"
            echo ""
            check_cpolar
            check_cpolar_login
            config_cpolar
            deploy_docker
            rebuild_frontend
            show_status
            echo -e "${GREEN}=========================================="
            echo "  部署完成！"
            echo "==========================================${NC}"
            ;;
        config)
            check_cpolar_login
            config_cpolar
            ;;
        build)
            rebuild_frontend
            ;;
        restart)
            restart_services
            ;;
        status)
            show_status
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}错误: 未知选项 '$1'${NC}"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# 运行主函数
main "$@"
