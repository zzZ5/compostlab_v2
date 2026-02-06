#!/bin/bash

# CompostLab 部署脚本（Docker 部分）
set -euo pipefail

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

# 读取 env 值（支持 KEY=VALUE）
read_env_value() {
    local file="$1"
    local key="$2"
    if [ -f "$file" ]; then
        grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- | tr -d '\r'
    fi
}

# 帮助信息
show_help() {
    cat << EOF
用法: ./deploy.sh [选项]

选项:
  build              - 重新构建前端（NEXT_PUBLIC_API_BASE 必须是 HTTPS）
  restart            - 重启 Docker 服务
  restart-mqtt       - 重启 MQTT Worker（遥测数据）
  restart-register   - 重启 MQTT Register Worker（设备注册）
  restart-all-mqtt   - 重启所有 MQTT Worker
  status             - 查看服务状态
  logs-mqtt          - 查看 MQTT Worker 日志（遥测数据）
  logs-register      - 查看 MQTT Register Worker 日志（设备注册）
  help               - 显示此帮助信息

示例:
  ./deploy.sh build            # 重建前端
  ./deploy.sh restart          # 重启服务
  ./deploy.sh restart-mqtt     # 重启 MQTT Worker
  ./deploy.sh restart-register # 重启设备注册 Worker
  ./deploy.sh logs-mqtt        # 查看 MQTT 遥测日志
  ./deploy.sh logs-register    # 查看设备注册日志

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

    api_base=$(read_env_value "frontend/.env.production" "NEXT_PUBLIC_API_BASE")
    echo "前端 API 地址：${api_base:-未配置}"
    echo ""

    # 确保是 HTTPS
    if [ -z "${api_base:-}" ] || ! echo "$api_base" | grep -qE '^https://'; then
        echo -e "${RED}错误: 环境变量不是 HTTPS！${NC}"
        echo "请手动编辑 frontend/.env.production 确保是 https://"
        exit 1
    fi

    # 停止并删除前端容器（仅前端）
    echo "停止前端容器..."
    docker compose stop frontend
    docker compose rm -f frontend

    # 清理构建缓存（仅构建缓存，避免影响其它服务）
    echo "清理 Docker 构建缓存..."
    docker builder prune -f

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
    docker compose exec -T frontend env | grep NEXT_PUBLIC_API_BASE
    echo ""

    # 检查是否是 HTTPS
    if docker compose exec -T frontend env | grep -qE '^NEXT_PUBLIC_API_BASE=https://'; then
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
    frontend_url=$(read_env_value "frontend/.env.production" "NEXT_PUBLIC_SITE_URL")
    backend_api=$(read_env_value "frontend/.env.production" "NEXT_PUBLIC_API_BASE")
    if [ -z "${backend_api:-}" ]; then
        backend_api="https://compostlab-backend-v2.cpolar.cn/api/v2"
    fi
    if [ -z "${frontend_url:-}" ]; then
        frontend_url="https://compostlab-v2.cpolar.cn"
    fi
    admin_url="${backend_api%/api/v2}/admin"

    echo -e "  前端: ${GREEN}${frontend_url}${NC}"
    echo -e "  后端: ${GREEN}${backend_api}${NC}"
    echo -e "  Admin: ${GREEN}${admin_url}${NC}"
    echo ""
}

# 重启 MQTT Worker（遥测数据）
restart_mqtt() {
    echo -e "${YELLOW}重启 MQTT Worker（遥测数据）...${NC}"
    docker compose restart mqtt_worker
    sleep 5
    echo -e "${GREEN}MQTT Worker 已重启${NC}"
    echo ""

    # 显示状态
    show_status
}

# 重启 MQTT Register Worker（设备注册）
restart_register() {
    echo -e "${YELLOW}重启 MQTT Register Worker（设备注册）...${NC}"
    docker compose restart mqtt_register_worker
    sleep 5
    echo -e "${GREEN}MQTT Register Worker 已重启${NC}"
    echo ""

    # 显示状态
    show_status
}

# 重启所有 MQTT Worker
restart_all_mqtt() {
    echo -e "${YELLOW}重启所有 MQTT Worker...${NC}"
    docker compose restart mqtt_worker mqtt_register_worker
    sleep 5
    echo -e "${GREEN}所有 MQTT Worker 已重启${NC}"
    echo ""

    # 显示状态
    show_status
}

# 查看 MQTT Worker 日志（遥测数据）
logs_mqtt() {
    echo -e "${YELLOW}MQTT Worker 日志（遥测数据，最近 50 行）：${NC}"
    echo ""
    docker compose logs --tail=50 mqtt_worker
}

# 查看 MQTT Register Worker 日志（设备注册）
logs_register() {
    echo -e "${YELLOW}MQTT Register Worker 日志（设备注册，最近 50 行）：${NC}"
    echo ""
    docker compose logs --tail=50 mqtt_register_worker
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
        restart-mqtt)
            restart_mqtt
            ;;
        restart-register)
            restart_register
            ;;
        restart-all-mqtt)
            restart_all_mqtt
            ;;
        status)
            show_status
            ;;
        logs-mqtt)
            logs_mqtt
            ;;
        logs-register)
            logs_register
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
