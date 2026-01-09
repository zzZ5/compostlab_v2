# CompostLab CPolar HTTPS 部署指南

## 快速开始

### 1. 首次部署

```bash
# 赋予执行权限
chmod +x deploy.sh

# 一键部署（安装 CPolar、配置 HTTPS、启动服务）
./deploy.sh install
```

### 2. 常用操作

```bash
# 配置/更新 CPolar HTTPS 隧道
./deploy.sh config

# 重新构建前端（使用 HTTPS）
./deploy.sh build

# 重启 Docker 服务
./deploy.sh restart

# 查看服务状态
./deploy.sh status
```

## 访问地址

部署完成后，使用以下地址访问：

- ✅ **前端**: https://compostlab-v2.cpolar.cn
- ✅ **后端**: https://compostlab-backend-v2.cpolar.cn/api/v2
- ✅ **Admin**: https://compostlab-backend-v2.cpolar.cn/admin

## 脚本说明

`deploy.sh` 是集成部署脚本，包含以下功能：

| 命令 | 说明 |
|------|------|
| `install` | 首次部署：安装 CPolar、配置 HTTPS、启动服务 |
| `config` | 配置/更新 CPolar HTTPS 隧道 |
| `build` | 重新构建前端（使用 HTTPS） |
| `restart` | 重启 Docker 服务 |
| `status` | 查看所有服务状态 |
| `help` | 显示帮助信息 |

## 配置文件

### 环境变量

- `.env.backend` - 后端环境变量（数据库、MQTT 等）
- `frontend/.env.production` - 前端环境变量（API 地址）

### CPolar 配置

CPolar 配置文件路径：`/usr/local/etc/cpolar/cpolar.yml`

```yaml
authtoken: your_token_here

tunnels:
  backend:
    proto: http
    addr: 8001
    region: cn
    subdomain: compostlab-backend-v2

  frontend:
    proto: http
    addr: 3000
    region: cn
    subdomain: compostlab-v2
```

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

### CPolar 隧道

```bash
# 查看隧道状态
cpolar status

# 停止所有隧道
cpolar stop-all

# 启动所有隧道
cpolar start-all

# 重新启动隧道
cpolar restart-all
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

### 2. CPolar 隧道未启用 HTTPS

**症状**: `cpolar status` 显示 HTTP 地址

**解决**:
1. 确认已购买 CPolar 付费套餐
2. 重新配置: `./deploy.sh config`
3. 检查控制台: https://dashboard.cpolar.com/

### 3. 登录失败

**症状**: 使用正确密码仍无法登录

**排查**:
```bash
# 1. 检查浏览器控制台（F12 -> Network）
# 2. 查看后端日志
docker compose logs backend --tail=50
# 3. 测试 API
curl https://compostlab-backend-v2.cpolar.cn/api/v2/devices/tree
```

### 4. 前端无法连接后端

**症状**: 登录失败，提示后端不可达

**解决**:
```bash
# 1. 检查后端是否运行
docker compose ps

# 2. 检查 CPolar 隧道
cpolar status

# 3. 测试后端 API
curl https://compostlab-backend-v2.cpolar.cn/api/v2/

# 4. 重新构建前端
./deploy.sh build
```

## 安全建议

### ⚠️ HTTPS 已启用

当前使用 CPolar 付费版 HTTPS，数据传输已加密。

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

## 部署流程图

```
1. 首次部署
   └─> ./deploy.sh install
       ├─> 安装/检查 CPolar
       ├─> 配置 HTTPS 隧道
       ├─> 启动 Docker 服务
       ├─> 执行数据库迁移
       ├─> 重新构建前端
       └─> 显示服务状态

2. 日常运维
   └─> ./deploy.sh config    # 更新 CPolar
   └─> ./deploy.sh build     # 重建前端
   └─> ./deploy.sh restart   # 重启服务
   └─> ./deploy.sh status    # 查看状态
```

## 技术支持

如有问题，请按以下顺序排查：

1. 查看服务状态：`./deploy.sh status`
2. 查看日志：`docker compose logs -f`
3. 检查 CPolar 隧道：`cpolar status`
4. 测试网络连接：`curl https://compostlab-backend-v2.cpolar.cn/api/v2/`

## 文件说明

| 文件 | 说明 |
|------|------|
| `deploy.sh` | 集成部署脚本（推荐使用） |
| `docker-compose.yml` | Docker 服务配置 |
| `Dockerfile.backend` | 后端镜像构建文件 |
| `frontend/Dockerfile` | 前端镜像构建文件 |
| `frontend/.env.production` | 前端环境变量 |
| `.env.backend` | 后端环境变量 |
| `requirements.txt` | Python 依赖 |
| `CPOLAR_HTTPS_GUIDE.md` | CPolar HTTPS 详细指南 |

祝部署顺利！
