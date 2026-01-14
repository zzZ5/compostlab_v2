# 设备注册功能部署指南

## 部署步骤

### 1. 应用数据库迁移

```bash
# 在本地或容器内执行
docker compose exec -T backend python manage.py migrate devices
```

### 2. 启动 MQTT Register Worker

#### 方式一：重新部署所有服务
```bash
./deploy.sh restart
```

#### 方式二：只重启 Register Worker
```bash
./deploy.sh restart-register
```

#### 方式三：手动启动（如果服务未运行）
```bash
# 启动所有服务
docker compose up -d mqtt_register_worker
```

### 3. 验证服务状态

```bash
# 查看所有服务状态
./deploy.sh status

# 查看注册 Worker 日志
./deploy.sh logs-register

# 或者直接查看 Docker 日志
docker compose logs -f mqtt_register_worker
```

### 4. 测试设备注册

#### 使用 MQTT 客户端测试

```bash
# 方式一：使用 mosquitto_pub
mosquitto_pub -h 118.25.108.254 -p 1883 \
  -u admin -P 'L05b03j..' \
  -t "compostlab/v2/TEST001/register" \
  -m '{
    "schema_version": 2,
    "ip_address": "192.168.1.100",
    "timestamp": "2026-01-14T12:00:00Z",
    "configuration": {
      "sampling_interval": 5,
      "firmware_version": "1.0.0"
    }
  }'
```

#### 使用 HTTP API 测试

```bash
curl -X POST http://localhost:8001/api/v2/devices/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "device_code": "TEST001",
    "schema_version": 2,
    "ip_address": "192.168.1.100",
    "configuration": {
      "sampling_interval": 5
    }
  }'
```

### 5. 验证注册结果

```bash
# 查看 Admin 后台
# 访问 https://compostlab-backend-v2.cpolar.cn/admin
# 进入 Devices 页面，查看新注册的设备

# 或通过 API 查询
curl http://localhost:8001/api/v2/devices \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Docker 服务说明

### 新增服务：mqtt_register_worker

```yaml
mqtt_register_worker:
  container_name: compostlab_mqtt_register_worker
  environment:
    MQTT_HOST: 118.25.108.254
    MQTT_PORT: 1883
    MQTT_REGISTER_TOPIC: compostlab/v2/+/register
  command: python manage.py mqtt_register_worker
  restart: unless-stopped
```

**功能：**
- 订阅 `compostlab/v2/+/register` 主题
- 自动处理设备注册请求
- 自动创建设备（如果不存在）
- 更新设备 IP 地址和配置信息

### 现有服务：mqtt_worker

```yaml
mqtt_worker:
  container_name: compostlab_mqtt_worker
  environment:
    MQTT_HOST: 118.25.108.254
    MQTT_PORT: 1883
  command: python manage.py mqtt_worker
```

**功能：**
- 订阅 `compostlab/v2/+/telemetry` 主题
- 处理设备遥测数据
- 与注册 Worker 完全独立

## 部署脚本使用

### restart-register
重启设备注册 Worker
```bash
./deploy.sh restart-register
```

### logs-register
查看设备注册 Worker 日志
```bash
./deploy.sh logs-register
```

### restart-all-mqtt
同时重启所有 MQTT Worker
```bash
./deploy.sh restart-all-mqtt
```

### logs-mqtt
查看遥测数据 Worker 日志
```bash
./deploy.sh logs-mqtt
```

## 环境变量配置

在 `.env.backend` 中配置：

```bash
# MQTT 基础配置
MQTT_HOST=118.25.108.254
MQTT_PORT=1883
MQTT_USER=admin
MQTT_PASS=L05b03j..

# 遥测数据主题（mqtt_worker）
MQTT_SUB_TOPIC=compostlab/v2/+/telemetry

# 设备注册主题（mqtt_register_worker）
MQTT_REGISTER_TOPIC=compostlab/v2/+/register
```

## 常见问题

### 1. Register Worker 无法连接 MQTT

**症状：**
```
[MQTT Register] connect failed rc=...
```

**解决方法：**
- 检查 MQTT 服务器地址和端口是否正确
- 检查用户名和密码是否正确
- 检查防火墙规则

### 2. 设备未自动创建

**症状：**
- 日志显示 `device=TEST001 status=UPDATED`，但设备不存在

**解决方法：**
- 检查设备是否已被手动删除
- 检查数据库连接是否正常
- 查看完整日志：`docker compose logs mqtt_register_worker`

### 3. IP 地址未更新

**症状：**
- 设备的 IP 地址字段为空

**解决方法：**
- 确认 payload 中包含 `ip_address` 字段
- 检查数据库迁移是否成功：`python manage.py migrate devices`

### 4. 如何重启服务

```bash
# 只重启注册 Worker
./deploy.sh restart-register

# 只重启遥测 Worker
./deploy.sh restart-mqtt

# 重启所有 MQTT Worker
./deploy.sh restart-all-mqtt

# 重启所有服务
./deploy.sh restart
```

## 监控和维护

### 查看服务状态

```bash
docker compose ps
```

应该看到以下服务在运行：
- `compostlab_backend`
- `compostlab_mqtt_worker`
- `compostlab_mqtt_register_worker` ← 新增
- `compostlab_frontend`
- `compostlab_tsdb`

### 查看日志

```bash
# 实时查看注册日志
docker compose logs -f mqtt_register_worker

# 查看最近 100 行
docker compose logs --tail=100 mqtt_register_worker

# 查看所有 MQTT Worker 日志
docker compose logs mqtt_worker mqtt_register_worker
```

### 健康检查

```bash
# 检查 Worker 是否正常订阅 MQTT
docker compose logs mqtt_register_worker | grep "connected"

# 应该看到：
# [MQTT Register] connected
```

## 数据库迁移

如果迁移失败，手动执行：

```bash
# 进入容器
docker compose exec backend bash

# 执行迁移
python manage.py migrate devices

# 退出容器
exit
```

## 完整部署流程

```bash
# 1. 停止所有服务
docker compose down

# 2. 启动所有服务
docker compose up -d

# 3. 等待服务启动
sleep 10

# 4. 执行数据库迁移
docker compose exec -T backend python manage.py migrate --noinput

# 5. 查看服务状态
docker compose ps

# 6. 查看注册 Worker 日志
docker compose logs mqtt_register_worker

# 7. 测试设备注册（使用 MQTT 客户端）
mosquitto_pub -h 118.25.108.254 -p 1883 \
  -u admin -P 'L05b03j..' \
  -t "compostlab/v2/TEST001/register" \
  -m '{"schema_version":2,"ip_address":"192.168.1.100"}'
```

## 卸载

如果需要移除注册 Worker：

```bash
# 停止并删除容器
docker compose stop mqtt_register_worker
docker compose rm -f mqtt_register_worker

# 或者从 docker-compose.yml 中删除相关配置后执行
docker compose down
```
