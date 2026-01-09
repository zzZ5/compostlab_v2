# CPolar 付费版 HTTPS 配置指南

## 前提条件

✅ 已购买 CPolar 付费套餐
✅ 已在服务器上安装并登录 cpolar

## 步骤1：配置 CPolar HTTPS 隧道

在服务器上执行：

```bash
# 赋予脚本执行权限
chmod +x update-cpolar-https.sh

# 运行配置脚本
./update-cpolar-https.sh
```

## 步骤2：验证 HTTPS 是否启用

```bash
# 查看隧道状态
cpolar status

# 检查是否显示 https:// 开头的地址
```

应该看到类似：
```
Frontend: https://compostlab-v2.cpolar.cn
Backend:  https://compostlab-backend-v2.cpolar.cn
```

## 步骤3：重新构建前端（使用 HTTPS）

```bash
# 赋予脚本执行权限
chmod +x rebuild-frontend-https.sh

# 重新构建前端
./rebuild-frontend-https.sh
```

## 步骤4：更新后端 CORS 配置

编辑 `compostlab_v2/settings.py`，确保添加 HTTPS 地址：

```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://compostlab-v2.cpolar.cn",  # HTTPS
]
```

重启后端：

```bash
docker compose restart backend
```

## 步骤5：访问测试

在浏览器中访问：

```
https://compostlab-v2.cpolar.cn
```

尝试登录，应该不再出现 Mixed Content 错误。

## 验证 HTTPS 配置

### 1. 检查前端环境变量

```bash
docker compose exec frontend env | grep NEXT_PUBLIC_API_BASE
# 应该显示: NEXT_PUBLIC_API_BASE=https://compostlab-backend-v2.cpolar.cn/api/v2
```

### 2. 测试 HTTPS API

```bash
# 测试后端 API（使用 HTTPS）
curl https://compostlab-backend-v2.cpolar.cn/api/v2/

# 如果提示证书问题，可以加 -k 参数（仅测试用）
curl -k https://compostlab-backend-v2.cpolar.cn/api/v2/
```

### 3. 浏览器检查

1. 打开浏览器访问 https://compostlab-v2.cpolar.cn
2. 按 F12 打开开发者工具
3. 切换到 Network 标签
4. 点击登录
5. 检查 API 请求：
   - 应该看到 `https://compostlab-backend-v2.cpolar.cn/api/v2/...`
   - 不应该再出现 Mixed Content 错误

## CPolar 手动配置（如果脚本不工作）

### 方法1：通过 CPolar Web 控制台

1. 访问 https://dashboard.cpolar.com/
2. 进入"隧道管理"
3. 找到对应的隧道
4. 编辑隧道设置
5. 启用 "HTTPS" 选项
6. 保存并重启

### 方法2：编辑配置文件

```bash
# 编辑配置文件
nano ~/.cpolar/cpolar.yml
```

确保配置如下：

```yaml
authtoken: 你的token

tunnels:
  backend:
    proto: http
    addr: 8001
    region: cn
    subdomain: compostlab-backend-v2
    cpolar_https: true  # 启用 HTTPS

  frontend:
    proto: http
    addr: 3000
    region: cn
    subdomain: compostlab-v2
    cpolar_https: true  # 启用 HTTPS
```

保存并重启：

```bash
cpolar restart-all
```

## 常见问题

### Q1: CPolar 状态显示 HTTP，没有 HTTPS

**原因**: 付费套餐没有启用 HTTPS 功能

**解决**:
1. 登录 CPolar 控制台
2. 检查套餐是否包含 HTTPS
3. 如果没有，需要升级套餐

### Q2: 浏览器提示证书无效

**原因**: 证书尚未生效或配置错误

**解决**:
1. 等待几分钟让证书生效
2. 检查 CPolar 隧道状态
3. 清除浏览器缓存
4. 尝试隐身模式访问

### Q3: 仍然出现 Mixed Content 错误

**原因**: 前端环境变量还是 HTTP

**解决**:
```bash
# 1. 检查配置
cat frontend/.env.production

# 2. 确保是 HTTPS
NEXT_PUBLIC_API_BASE=https://compostlab-backend-v2.cpolar.cn/api/v2

# 3. 重新构建
./rebuild-frontend-https.sh
```

### Q4: 后端 ALLOWED_HOSTS 错误

**原因**: 没有添加 HTTPS 域名

**解决**:
编辑 `.env.backend`:
```env
ALLOWED_HOSTS=localhost,127.0.0.1,compostlab-backend-v2.cpolar.cn
```

重启后端：
```bash
docker compose restart backend
```

## 手动配置步骤（完整）

如果脚本不工作，可以手动配置：

### 1. 更新前端环境变量

```bash
nano frontend/.env.production
```

内容：
```env
NEXT_PUBLIC_API_BASE=https://compostlab-backend-v2.cpolar.cn/api/v2
```

### 2. 更新 docker-compose.yml

```bash
nano docker-compose.yml
```

找到 frontend 部分，确保：
```yaml
environment:
  NEXT_PUBLIC_API_BASE: https://compostlab-backend-v2.cpolar.cn/api/v2
```

### 3. 配置 CPolar 隧道

```bash
nano ~/.cpolar/cpolar.yml
```

内容：
```yaml
authtoken: 你的token

tunnels:
  backend:
    proto: http
    addr: 8001
    region: cn
    subdomain: compostlab-backend-v2
    cpolar_https: true

  frontend:
    proto: http
    addr: 3000
    region: cn
    subdomain: compostlab-v2
    cpolar_https: true
```

### 4. 重启服务

```bash
# 重启 CPolar
cpolar restart-all

# 重新构建前端
docker compose stop frontend
docker compose rm -f frontend
docker compose build --no-cache frontend
docker compose up -d frontend

# 重启后端（如果更新了 CORS）
docker compose restart backend
```

### 5. 验证

```bash
# 检查 CPolar 状态
cpolar status

# 检查前端环境变量
docker compose exec frontend env | grep NEXT_PUBLIC_API_BASE

# 测试 API
curl https://compostlab-backend-v2.cpolar.cn/api/v2/
```

## 访问地址（HTTPS）

配置完成后，使用以下地址访问：

- ✅ **前端**: https://compostlab-v2.cpolar.cn
- ✅ **后端**: https://compostlab-backend-v2.cpolar.cn/api/v2
- ✅ **Admin**: https://compostlab-backend-v2.cpolar.cn/admin

## 安全提示

现在使用 HTTPS，数据传输已加密：
- ✅ 密码安全传输
- ✅ 数据防篡改
- ✅ 防止中间人攻击

适合生产环境使用！

## 联系支持

如果以上步骤仍不能解决问题：

1. 查看 CPolar 官方文档：https://www.cpolar.com/docs/
2. 联系 CPolar 客服：support@cpolar.com
3. 检查 CPolar 控制台日志

祝配置顺利！
