# 账号系统使用说明

## 🎯 功能概述

完整的账号系统，包括：
- **JWT Token 认证**（替代原 Basic Auth）
- **三级角色权限**：只读用户、操作员、管理员
- **用户管理**：创建/编辑/禁用用户
- **操作日志**：自动记录所有重要操作
- **个人中心**：修改密码、查看个人信息

## 🔧 部署步骤

### 1. 安装依赖

```bash
docker compose exec backend pip install djangorestframework-simplejwt
```

或在重新构建镜像前更新 `requirements.txt`（已包含）。

### 2. 应用数据库迁移

```bash
# 生成迁移文件
docker compose exec backend python manage.py makemigrations accounts

# 应用迁移
docker compose exec backend python manage.py migrate accounts
```

### 3. 创建超级管理员

```bash
docker compose exec backend python manage.py createsuperuser
```

按提示输入用户名、邮箱和密码。

### 4. 为现有用户创建 Profile

如果有老用户，需要为他们创建 Profile：

```bash
docker compose exec backend python manage.py shell
```

然后执行：

```python
from django.contrib.auth.models import User
from apps.accounts.models import UserProfile

for user in User.objects.all():
    profile, created = UserProfile.objects.get_or_create(
        user=user,
        defaults={"role": "admin" if user.is_staff else "readonly"}
    )
    if created:
        print(f"Created profile for {user.username}")
```

### 5. 重启服务

```bash
docker compose restart backend frontend
```

## 👥 用户角色说明

### 只读用户（readonly）
- 查看所有数据
- 导出数据
- **不能**修改任何配置

### 操作员（operator）
- 只读用户的所有权限
- 控制设备、发送命令
- 创建/修改通道配置
- **不能**删除设备、管理用户

### 管理员（admin）
- 操作员的所有权限
- 创建/删除设备
- 创建/删除运行批次
- 管理用户账号
- 查看所有操作日志

## 🔐 API 认证方式

### 新方式：JWT Token（推荐）

```bash
# 1. 登录获取 token
curl -X POST http://localhost:8001/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'

# 返回：
# {
#   "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
#   "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
#   "user": {...}
# }

# 2. 使用 access token 访问 API
curl http://localhost:8001/api/v2/devices/tree \
  -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc..."

# 3. Token 过期后刷新
curl -X POST http://localhost:8001/api/v2/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh":"eyJ0eXAiOiJKV1QiLCJhbGc..."}'
```

### 旧方式：Basic Auth（兼容）

```bash
curl http://localhost:8001/api/v2/devices/tree \
  -u username:password
```

## 📋 API 端点列表

### 认证相关
- `POST /api/v2/auth/login` - 登录
- `POST /api/v2/auth/refresh` - 刷新 token
- `POST /api/v2/auth/logout` - 登出（记录日志）
- `GET /api/v2/auth/me` - 获取当前用户信息
- `POST /api/v2/auth/change-password` - 修改密码
- `GET /api/v2/auth/my-logs` - 查看自己的操作日志

### 用户管理（管理员）
- `GET /api/v2/users` - 用户列表
- `GET /api/v2/users/<id>` - 用户详情
- `POST /api/v2/users/create` - 创建用户
- `PUT /api/v2/users/<id>/update` - 更新用户
- `POST /api/v2/users/<id>/toggle-active` - 启用/禁用用户

### 审计日志（管理员）
- `GET /api/v2/audit-logs` - 查看操作日志

## 🌐 前端页面

- `/login` - 登录页面
- `/profile` - 个人中心
- `/users` - 用户管理（仅管理员可见）
- `/audit-logs` - 操作日志（仅管理员可见）

## 🔒 安全特性

1. **JWT Token**：
   - Access token 有效期 8 小时
   - Refresh token 有效期 7 天
   - 自动刷新机制，无需频繁登录

2. **密码安全**：
   - Django 默认密码验证器
   - 最少 8 位
   - 不能是常见密码
   - 不能全是数字

3. **操作审计**：
   - 记录 IP 地址和 User-Agent
   - 记录变更内容（JSON）
   - 删除用户后日志仍保留

4. **权限控制**：
   - API 级别的角色验证
   - 前端菜单根据权限显示

## 📝 常见问题

### Q: 如何重置用户密码？

管理员通过 Django Admin 或命令行：

```bash
docker compose exec backend python manage.py shell
```

```python
from django.contrib.auth.models import User
user = User.objects.get(username='用户名')
user.set_password('新密码')
user.save()
```

### Q: 如何查看某个用户的操作历史？

管理员访问 `/audit-logs` 页面，按用户名筛选。

### Q: Token 过期怎么办？

前端会自动使用 refresh token 刷新 access token。如果 refresh token 也过期，会自动跳转到登录页。

### Q: 如何批量导入用户？

```bash
docker compose exec backend python manage.py shell
```

```python
from django.contrib.auth.models import User
from apps.accounts.models import UserProfile

users_data = [
    {"username": "zhangsan", "password": "password123", "role": "operator"},
    {"username": "lisi", "password": "password123", "role": "readonly"},
]

for data in users_data:
    user = User.objects.create_user(
        username=data["username"],
        password=data["password"]
    )
    UserProfile.objects.create(user=user, role=data["role"])
    print(f"Created {user.username}")
```

## 🚀 升级建议

从原 Basic Auth 系统升级：

1. **不破坏现有用户**：JWT 和 Basic Auth 可以并存
2. **逐步迁移**：
   - 新用户使用 JWT
   - 旧用户继续使用 Basic Auth 或主动切换
3. **数据保留**：迁移不影响现有数据

## 📊 监控建议

定期检查：
- 失败的登录尝试（可能是暴力破解）
- 异常的操作日志（不寻常的时间/IP）
- 禁用的用户账号状态

通过审计日志查询：
```sql
-- 查看失败的登录尝试
SELECT * FROM accounts_auditlog 
WHERE action = 'login' AND success = false 
ORDER BY created_at DESC LIMIT 50;
```
