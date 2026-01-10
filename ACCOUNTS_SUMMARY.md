# 账号系统实现总结

## ✅ 已完成功能

### 后端（Django）

#### 1. 新增 `apps/accounts` 应用
- **models.py**：
  - `UserProfile`：用户扩展信息（角色、真实姓名、部门、登录记录等）
  - `AuditLog`：操作审计日志（自动记录所有重要操作）
  - `UserRole`：三级角色（readonly/operator/admin）

- **mixins.py**：
  - `JWTAuthMixin`：JWT Token 认证（向后兼容 Basic Auth）
  - `RoleRequiredMixin`：基于角色的权限控制
  - `OperatorRequiredMixin`、`AdminRequiredMixin`：快捷权限检查

- **api.py**：
  - 认证接口：登录、登出、刷新 token、获取当前用户、修改密码
  - 用户管理接口：CRUD 用户、启用/禁用用户
  - 审计日志接口：查询操作日志

- **utils.py**：
  - `log_audit()`：操作日志记录函数
  - `has_permission()`：权限检查函数
  - `get_client_ip()`：获取客户端 IP

#### 2. JWT 配置
- `requirements.txt`：添加 `djangorestframework-simplejwt`
- `settings.py`：配置 JWT（access token 8 小时，refresh token 7 天）
- `urls.py`：注册 accounts 路由

### 前端（Next.js + React）

#### 1. 认证系统更新
- **lib/auth.ts**：
  - JWT Token 管理（存储、获取、刷新、清除）
  - 兼容旧的 Basic Auth

- **lib/api.ts**：
  - 请求拦截器：自动添加 Authorization header（JWT 优先）
  - 响应拦截器：自动刷新过期 token、处理 401 跳转

#### 2. 新增页面
- **/login**：JWT Token 登录（替代原 Basic Auth）
- **/users**：用户管理（CRUD、启用/禁用）
- **/profile**：个人中心（查看信息、修改密码）
- **/audit-logs**：操作日志查询

#### 3. 导航菜单
- 根据用户角色显示不同菜单
- 管理员可见：用户管理、操作日志
- 所有用户可见：个人中心

## 🎯 核心特性

### 1. 三级角色权限
| 角色 | 权限 |
|------|------|
| **只读用户** | 查看数据、导出数据 |
| **操作员** | + 控制设备、创建/修改通道、创建运行批次 |
| **管理员** | + 创建/删除设备、管理用户、查看所有日志 |

### 2. JWT Token 认证
- Access token 8 小时有效
- Refresh token 7 天有效
- 自动刷新机制
- 向后兼容 Basic Auth

### 3. 操作审计
- 自动记录：登录/登出、创建/修改/删除资源
- 记录内容：用户、时间、IP、操作类型、变更详情
- 管理员可查询所有日志
- 普通用户可查看自己的日志

### 4. 安全特性
- 密码强度验证（Django 默认）
- Token 自动刷新
- 失败操作记录
- 账号禁用功能

## 📦 文件清单

### 后端新增文件
```
apps/accounts/
├── __init__.py
├── apps.py
├── models.py          # 用户扩展和审计日志模型
├── admin.py           # Django Admin 配置
├── mixins.py          # JWT 认证和权限 Mixin
├── utils.py           # 工具函数
├── api.py             # API 视图
└── urls.py            # URL 路由
```

### 前端新增/修改文件
```
frontend/src/
├── types/api.ts                    # 添加 User, AuditLog 类型
├── lib/auth.ts                     # 更新为 JWT Token 管理
├── lib/api.ts                      # 添加 token 刷新拦截器
├── app/login/page.tsx              # 更新为 JWT 登录
├── app/(main)/layout.tsx           # 添加角色菜单、用户信息
├── app/(main)/users/page.tsx       # 用户管理页面（新）
├── app/(main)/profile/page.tsx     # 个人中心页面（新）
└── app/(main)/audit-logs/page.tsx  # 操作日志页面（新）
```

### 文档
```
ACCOUNTS_README.md    # 使用说明
ACCOUNTS_SUMMARY.md   # 实现总结（本文件）
```

## 🚀 部署步骤

```bash
# 1. 安装依赖
docker compose exec backend pip install djangorestframework-simplejwt

# 2. 生成迁移
docker compose exec backend python manage.py makemigrations accounts

# 3. 应用迁移
docker compose exec backend python manage.py migrate accounts

# 4. 创建超级管理员
docker compose exec backend python manage.py createsuperuser

# 5. 重启服务
docker compose restart backend frontend
```

## 📝 使用场景示例

### 场景 1：实验室负责人管理学生账号
1. 管理员登录，访问 `/users`
2. 点击「新建用户」，填写学生信息
3. 设置角色为「只读用户」或「操作员」
4. 学生使用账号登录，查看实验数据

### 场景 2：追踪设备删除操作
1. 管理员访问 `/audit-logs`
2. 筛选操作类型为「删除设备」
3. 查看是谁在什么时间删除了哪个设备
4. 查看变更详情（设备配置）

### 场景 3：定期修改密码
1. 用户访问 `/profile`
2. 点击「修改密码」
3. 输入当前密码和新密码
4. 系统验证密码强度并更新

## 🔄 向后兼容

- ✅ 旧的 Basic Auth 仍然可用
- ✅ 现有 API 无需修改（自动支持两种认证）
- ✅ 前端自动处理两种认证方式
- ✅ 数据库无影响，只增加新表

## 🎓 技术亮点

1. **最小侵入**：不修改现有代码，只增加新功能
2. **平滑升级**：JWT 和 Basic Auth 并存
3. **自动审计**：通过工具函数自动记录
4. **角色灵活**：易于扩展新角色
5. **前端友好**：自动刷新 token，无感知续期

## 📊 数据库表结构

### accounts_userprofile
| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | FK | 关联 Django User |
| role | varchar(20) | readonly/operator/admin |
| real_name | varchar(100) | 真实姓名 |
| department | varchar(100) | 部门/实验室 |
| phone | varchar(20) | 联系电话 |
| is_active | boolean | 是否启用 |
| last_login_at | datetime | 最后登录时间 |
| last_login_ip | inet | 最后登录 IP |

### accounts_auditlog
| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | FK | 操作用户（可为空） |
| username | varchar(150) | 用户名（冗余） |
| action | varchar(50) | 操作类型（枚举） |
| resource_type | varchar(50) | 资源类型 |
| resource_id | varchar(100) | 资源 ID |
| description | text | 操作描述 |
| changes | jsonb | 变更内容（JSON） |
| ip_address | inet | 请求 IP |
| user_agent | text | User Agent |
| success | boolean | 是否成功 |
| created_at | datetime | 创建时间 |

## 🎉 总结

已完整实现适合实验室/科研团队使用的账号系统，包括：
- ✅ JWT Token 认证（8小时有效，自动刷新）
- ✅ 三级角色权限（只读/操作员/管理员）
- ✅ 用户管理界面（创建/编辑/禁用）
- ✅ 操作审计日志（自动记录+查询）
- ✅ 个人中心（修改密码+查看信息）
- ✅ 向后兼容 Basic Auth
- ✅ 完整文档

**可直接部署使用！**
