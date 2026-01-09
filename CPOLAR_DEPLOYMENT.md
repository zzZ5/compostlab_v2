# CPolar 部署指南

## 快速开始

### 1. 部署服务

```bash
# 授予脚本执行权限
chmod +x deploy-cpolar.sh update-frontend.sh

# 运行部署脚本
./deploy-cpolar.sh
```

### 2. 访问应用

部署完成后，使用以下地址访问：

- **前端界面**: http://compostlab-v2.cpolar.cn
- **后端 API**: http://compostlab-backend-v2.cpolar.cn/api/v2
- **Admin 后台**: http://compostlab-backend-v2.cpolar.cn/admin

### 3. 更新前端配置

如果需要更新前端配置：

```bash
./update-frontend.sh
```

## 配置说明

### CPolar 域名配置

- **前端**: `compostlab-v2.cpolar.cn` (端口 3000)
- **后端**: `compostlab-backend-v2.cpolar.cn` (端口 8001)

配置文件位置：`~/.cpolar/cpolar.yml`

```yaml
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

### 前端环境变量

文件位置：`frontend/.env.production`

```env
NEXT_PUBLIC_API_BASE=http://compostlab-backend-v2.cpolar.cn/api/v2
```

### 后端 CORS 配置

`compostlab_v2/settings.py` 已配置允许前端访问：

```python
CORS_ALLOWED_ORIGINS = [
    "http://compostlab-v2.cpolar.cn",
]
```

## 部署步骤详解

### 第一步：安装 CPolar

```bash
# 一键安装
curl -L https://www.cpolar.com/static/downloads/install-release-cpolar.sh | sudo bash

# 注册账号
# 访问 https://dashboard.cpolar.com/ 注册账号，获取 token

# 登录 CPolar
cpolar authtoken <your-token>
```

### 第二步：部署服务

```bash
# 运行部署脚本
./deploy-cpolar.sh
```

脚本会自动：
1. 检查并安装 cpolar
2. 创建 CPolar 配置文件
3. 启动 Docker 服务
4. 启动 CPolar 隧道

### 第三步：验证部署

```bash
# 检查服务状态
docker compose ps

# 检查 CPolar 隧道状态
cpolar status

# 测试后端 API
curl http://compostlab-backend-v2.cpolar.cn/api/v2/devices/tree
```

## 常用命令

### CPolar 命令

```bash
# 查看隧道状态
cpolar status

# 停止所有隧道
cpolar stop-all

# 启动所有隧道
cpolar start-all

# 重新启动隧道
cpolar restart-all

# 查看日志
cpolar logs
```

### Docker 命令

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

### 1. 前端无法连接后端

**症状**: 登录失败，提示"账号/密码错误，或后端不可达"

**解决方法**:
```bash
# 1. 检查后端是否运行
curl http://compostlab-backend-v2.cpolar.cn/api/v2/devices/tree

# 2. 检查前端环境变量
cat frontend/.env.production

# 3. 重新构建前端
docker compose up -d --build frontend
```

### 2. CPolar 隧道断开

**症状**: 无法访问 cpolar 域名

**解决方法**:
```bash
# 1. 查看隧道状态
cpolar status

# 2. 重启隧道
cpolar restart-all

# 3. 查看日志
cpolar logs
```

### 3. Docker 服务异常

**症状**: 服务无法启动或频繁崩溃

**解决方法**:
```bash
# 1. 查看服务状态
docker compose ps

# 2. 查看日志
docker compose logs backend
docker compose logs frontend

# 3. 重启服务
docker compose restart
```

### 4. 登录失败

**症状**: 使用正确的用户名密码仍无法登录

**排查步骤**:
```bash
# 1. 检查浏览器控制台
# 按 F12，查看 Network 标签中的请求详情

# 2. 检查后端日志
docker compose logs backend --tail=50

# 3. 测试 API
curl -u admin:你的密码 http://compostlab-backend-v2.cpolar.cn/api/v2/devices/tree

# 4. 检查数据库中的用户
docker compose exec db psql -U compostlab -d compostlab -c "SELECT id, username, is_staff, is_active FROM auth_user;"
```

## 安全建议

### ⚠️ 重要提醒

CPolar 公网地址是**不加密的 HTTP**，存在以下安全风险：

1. **任何人都可访问** - 没有身份验证的保护
2. **密码明文传输** - Basic Auth 密码可被窃听
3. **无访问控制** - 没有防火墙或 IP 限制

### 安全措施

#### 1. 修改默认密码

```bash
# 创建强密码的超级用户
docker compose exec backend python manage.py changepassword admin
```

#### 2. 添加 IP 白名单（可选）

编辑 `compostlab_v2/settings.py`:

```python
# 在文件末尾添加
ALLOWED_IPS = os.environ.get("ALLOWED_IPS", "").split(",")

if ALLOWED_IPS and not any(ip for ip in ALLOWED_IPS if ip):
    class IPWhitelistMiddleware:
        def __init__(self, get_response):
            self.get_response = get_response

        def __call__(self, request):
            ip = self.get_client_ip(request)
            if ip not in ALLOWED_IPS:
                from django.http import HttpResponseForbidden
                return HttpResponseForbidden("Access Denied")
            return self.get_response(request)

        def get_client_ip(self, request):
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip = x_forwarded_for.split(',')[0].strip()
            else:
                ip = request.META.get('REMOTE_ADDR')
            return ip

    MIDDLEWARE.insert(0, 'compostlab_v2.middleware.IPWhitelistMiddleware')
```

在 `.env.backend` 中添加允许的 IP：
```env
ALLOWED_IPS=1.2.3.4,5.6.7.8  # 替换成你的 IP 地址
```

#### 3. 启用 HTTPS（推荐）

**选项 1**: 使用 CPolar 付费版获取 HTTPS
**选项 2**: 使用 Nginx + Let's Encrypt

```bash
# 安装 certbot
sudo apt install certbot

# 申请证书（需要先有域名和 VPS）
sudo certbot certonly --standalone -d your-domain.com
```

#### 4. 定期备份数据

```bash
# 创建备份脚本
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/srv/backups"
mkdir -p $BACKUP_DIR
docker compose exec db pg_dump -U compostlab compostlab > $BACKUP_DIR/compostlab_$(date +%Y%m%d_%H%M%S).sql
# 保留最近 30 天的备份
find $BACKUP_DIR -name "compostlab_*.sql" -mtime +30 -delete
EOF

chmod +x backup.sh

# 设置定时任务（每天凌晨 2 点备份）
crontab -e
# 添加: 0 2 * * * /srv/compostlab_v2/backup.sh
```

## 生产环境建议

对于生产环境，强烈建议：

1. **使用 VPS 服务器** - 购买云服务器（阿里云、腾讯云等）
2. **购买域名** - 获取自己的域名
3. **配置 Nginx 反向代理** - 统一管理前后端
4. **启用 HTTPS** - 使用 Let's Encrypt 免费证书
5. **配置防火墙** - 使用 ufw 或 iptables
6. **配置监控告警** - 使用 Prometheus + Grafana
7. **配置日志管理** - 使用 ELK Stack 或 Loki
8. **配置自动备份** - 每日自动备份数据库

## 性能优化

### 1. 数据库优化

```bash
# 进入数据库
docker compose exec db psql -U compostlab -d compostlab

# 创建索引（如果还没有）
CREATE INDEX IF NOT EXISTS idx_device_code ON devices_device(code);
CREATE INDEX IF NOT EXISTS idx_device_active_seen ON devices_device(is_active, last_seen_at);

# 退出
\q
```

### 2. 后端优化

编辑 `Dockerfile.backend`:

```dockerfile
# 使用 Gunicorn 多 worker
CMD ["gunicorn", "compostlab_v2.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4", "--timeout", "60"]
```

### 3. 前端优化

前端已经构建为静态文件，性能已经优化。

## 监控和维护

### 监控脚本

```bash
#!/bin/bash
# health-check.sh

# 检查服务状态
if ! docker compose ps | grep -q "Up"; then
    echo "Docker 服务未运行，正在重启..."
    docker compose up -d
fi

# 检查 CPolar 隧道
if ! cpolar status | grep -q "Active"; then
    echo "CPolar 隧道未运行，正在重启..."
    cpolar start-all
fi

# 测试后端 API
if ! curl -s http://compostlab-backend-v2.cpolar.cn/api/v2 > /dev/null; then
    echo "后端 API 无响应"
fi

echo "健康检查完成"
```

设置定时任务（每 5 分钟检查一次）:
```bash
crontab -e
# 添加: */5 * * * * /srv/compostlab_v2/health-check.sh >> /var/log/health-check.log 2>&1
```

## 联系和支持

如有问题，请按以下顺序排查：

1. 检查 Docker 服务状态：`docker compose ps`
2. 检查 CPolar 隧道状态：`cpolar status`
3. 查看服务日志：`docker compose logs -f`
4. 测试网络连接：`curl http://compostlab-backend-v2.cpolar.cn/api/v2`

祝部署顺利！
