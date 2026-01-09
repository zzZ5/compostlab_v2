#!/bin/bash

# CompostLab 部署脚本（Docker 部分）
set -e

echo "=========================================="
echo "  CompostLab 部署工具"
echo "=========================================="
echo ""

# 脚本目录
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
  build       - 重新构建前端（使用 HTTPS）
  restart     - 重启 Docker 服务
  status      - 查看服务状态
  help        - 显示此帮助信息

示例:
  ./deploy.sh build        # 重建前端
  ./deploy.sh restart      # 重启服务

注意: CPolar 隧道请在网页控制台配置
EOF
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

    # 确保是 HTTPS
    if ! grep -q "https://" frontend/.env.production; then
        echo -e "${RED}错误: 环境变量不是 HTTPS！${NC}"
        echo "请手动编辑 frontend/.env.production 确保是 https://"
        exit 1
    fi

    # 停止并删除前端容器
    echo "停止前端容器..."
    docker compose stop frontend
    docker compose rm -f frontend

    # 清理构建缓存（重要！）
    echo "清理 Docker 构建缓存..."
    docker system prune -f

    # 重新构建前端（强制无缓存）
    echo "重新构建前端镜像（无缓存）..."
    docker compose build --no-cache --pull frontend

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

    # 检查是否是 HTTPS
    if docker compose exec frontend env | grep -q "https://"; then
        echo -e "${GREEN}✓ HTTPS 配置正确${NC}"
    else
        echo -e "${RED}✗ 仍然是 HTTP！${NC}"
        echo "请检查 docker-compose.yml 中的 build.args"
        exit 1
    fi

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

    # 显示状态
    show_status
}

# 查看状态
show_status() {
    echo "=== Docker 服务状态 ==="
    docker compose ps
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
