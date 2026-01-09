# CPolar 部署指南

## 快速开始

### 1. 部署服务

```bash
# 授予脚本执行权限
chmod +x deploy-cpolar.sh update-frontend.sh

# 运行部署脚本
./deploy-cpolar.sh
```

### 2. 获取公网地址

部署完成后，CPolar 会显示类似地址：
```
Frontend: http://xxx.cpolar.cn
Backend:  http://yyy.cpolar.cn
```

### 3. 更新前端配置

```bash
# 使用后端的 CPolar 地址更新前端
./update-frontend.sh http://yyy.cpolar.cn
```

### 4. 访问应用

- **前端界面**: http://xxx.cpolar.cn
- **后端 API**: http://yyy.cpolar.cn/api/v2
- **Admin 后台**: http://yyy.cpolar.cn/admin

## 安全建议

### ⚠️ 重要提醒

CPolar 公网地址是**不加密的 HTTP**，任何人都可以访问。为了安全，请：

1. **不要使用默认密码** - 修改 Django 超级用户密码
2. **启用 HTTPS** - 升级 CPolar 付费版或使用 Nginx + Let's Encrypt
3. **限制访问** - 在 Django settings 中添加 IP 白名单
4. **定期备份数据库** - 避免数据丢失

### 启用 IP 白名单（可选）

编辑 `compostlab_v2/settings.py`:

```python
# 添加 IP 白名单中间件
ALLOWED_IPS = ["127.0.0.1", "你的公网IP"]  # 如果你的 IP 固定

class IPWhitelistMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        ip = self.get_client_ip(request)
        if ip not in ALLOWED_IPS:
            return HttpResponseForbidden("Access Denied")
        return self.get_response(request)

    def get_client_ip(self, request):
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

MIDDLEWARE = [
    ...
    'compostlab_v2.middleware.IPWhitelistMiddleware',
    ...
]
```

## 常用命令

### CPolar 命令

```bash
# 查看隧道状态
cpolar status

# 停止所有隧道
cpolar stop-all

# 查看日志
cpolar logs

# 重新启动隧道
cpolar restart-all
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
```

## 故障排查

### 1. 前端无法连接后端

- 检查 `frontend/.env.production` 中的 `NEXT_PUBLIC_API_BASE` 是否正确
- 确认后端 CPolar 隧道正在运行：`cpolar status`
- 测试后端 API：`curl http://后端cpolar地址/api/v2/devices/tree`

### 2. 登录失败

- 确认使用了正确的用户名和密码
- 检查浏览器控制台的网络请求
- 查看后端日志：`docker compose logs backend --tail=50`

### 3. CPolar 隧道断开

```bash
# 重启 CPolar
cpolar restart-all

# 重新启动服务
docker compose restart
```

## 数据库备份

```bash
# 备份数据库
docker compose exec db pg_dump -U compostlab compostlab > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose exec -T db psql -U compostlab compostlab < backup_20260109.sql
```

## 生产环境建议

对于生产环境，建议：

1. **使用 VPS 服务器** - 购买云服务器，不再依赖 CPolar
2. **配置 Nginx 反向代理** - 统一管理前后端
3. **启用 HTTPS** - 使用 Let's Encrypt 免费证书
4. **配置防火墙** - 限制端口访问
5. **配置监控告警** - 及时发现问题

## 联系方式

如有问题，请检查：
1. Docker 服务是否正常运行
2. CPolar 隧道是否启动
3. 网络连接是否正常
