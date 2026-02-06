# CompostLab 部署指南

## 快速开始

### 1. 首次部署

```bash
# 配置环境变量（必要）
cp .env.backend.example .env.backend
cp frontend/.env.production.example frontend/.env.production
# 按需修改其中的数据库与 API 地址

# 启动 Docker 服务
docker compose up -d

# 执行数据库迁移
docker compose exec backend python manage.py migrate
```

### 2. 常用操作

```bash
# 重新构建前端（使用 HTTPS）
./deploy.sh build

# 重启 Docker 服务
./deploy.sh restart

# 查看服务状态
./deploy.sh status
```

## 访问地址

以 `frontend/.env.production` 为准（推荐配置）：

- ✅ **前端**: `NEXT_PUBLIC_SITE_URL`
- ✅ **后端**: `NEXT_PUBLIC_API_BASE`
- ✅ **Admin**: `${NEXT_PUBLIC_API_BASE%/api/v2}/admin`

## 脚本说明

`deploy.sh` 是部署脚本，包含以下功能：

| 命令 | 说明 |
|------|------|
| `build` | 重新构建前端（使用 HTTPS） |
| `restart` | 重启 Docker 服务 |
| `status` | 查看所有服务状态 |
| `help` | 显示帮助信息 |

## 配置文件

### 环境变量（必配）

- `.env.backend` - 后端环境变量（数据库、MQTT 等）
- `frontend/.env.production` - 前端环境变量（站点与 API 地址）

### CPolar 配置（如使用）

CPolar 隧道在网页控制台配置（示例）：
- 前端: https://compostlab-v2.cpolar.cn (端口 3000)
- 后端: https://compostlab-backend-v2.cpolar.cn (端口 8001)

如需修改，请访问：https://dashboard.cpolar.com/

## 常用命令

### Docker 服务

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 完全重启
docker compose down && docker compose up -d
```

### 数据库操作

```bash
# 进入数据库
docker compose exec db psql -U compostlab -d compostlab

# 备份数据库
docker compose exec db pg_dump -U compostlab compostlab > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose exec -T db psql -U compostlab compostlab < backup_20260109.sql
```

## 故障排查

### 1. Mixed Content 错误

**症状**: HTTPS 页面无法请求 HTTP API

**解决**:
```bash
# 确保前端使用 HTTPS
cat frontend/.env.production
# 应该显示: NEXT_PUBLIC_API_BASE=https://...

# 重新构建前端
./deploy.sh build
```

### 2. 登录失败

**症状**: 使用正确密码仍无法登录

**排查**:
```bash
# 1. 检查浏览器控制台（F12 -> Network）
# 2. 查看后端日志
docker compose logs backend --tail=50
# 3. 测试 API
curl https://compostlab-backend-v2.cpolar.cn/api/v2/devices/tree
```

### 3. 前端无法连接后端

**症状**: 登录失败，提示后端不可达

**解决**:
```bash
# 1. 检查后端是否运行
docker compose ps

# 2. 测试后端 API
curl https://compostlab-backend-v2.cpolar.cn/api/v2/

# 3. 重新构建前端
./deploy.sh build
```

### 4. 服务启动失败

**症状**: Docker 容器无法启动

**解决**:
```bash
# 1. 查看服务状态
docker compose ps

# 2. 查看日志
docker compose logs backend
docker compose logs frontend

# 3. 检查配置
cat .env.backend
cat frontend/.env.production
```

## 安全建议

### 已启用 HTTPS

当前使用 CPolar HTTPS，数据传输已加密。

### 建议安全措施

1. **修改默认密码**
```bash
docker compose exec backend python manage.py changepassword admin
```

2. **定期备份数据**
```bash
# 创建备份目录
mkdir -p backups

# 定期备份
docker compose exec db pg_dump -U compostlab compostlab > backups/compostlab_$(date +%Y%m%d_%H%M%S).sql
```

3. **监控服务状态**
```bash
# 查看服务健康状态
docker compose ps

# 查看资源使用
docker stats
```

## 技术支持

如有问题，请按以下顺序排查：

1. 查看服务状态：`./deploy.sh status`
2. 查看日志：`docker compose logs -f`
3. 测试网络连接：`curl https://compostlab-backend-v2.cpolar.cn/api/v2/`

## 文件说明

| 文件 | 说明 |
|------|------|
| `deploy.sh` | 部署脚本 |
| `docker-compose.yml` | Docker 服务配置 |
| `Dockerfile.backend` | 后端镜像构建文件 |
| `frontend/Dockerfile` | 前端镜像构建文件 |
| `frontend/.env.production` | 前端环境变量 |
| `.env.backend` | 后端环境变量 |
| `requirements.txt` | Python 依赖 |

祝使用顺利！
