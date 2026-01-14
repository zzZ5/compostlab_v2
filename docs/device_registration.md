# 设备注册功能说明

## 概述

设备注册功能允许设备通过 MQTT 或 HTTP 上线时自动注册并更新信息。

## MQTT Topic 设计

### 设备注册
- **Topic**: `compostlab/v2/{device_code}/register`
- **QoS**: 1
- **Payload**: JSON 格式

### 设备遥测
- **Topic**: `compostlab/v2/{device_code}/telemetry`
- **QoS**: 1
- **Payload**: V2 遥测格式

## 注册 Payload 格式

```json
{
  "schema_version": 2,
  "ip_address": "192.168.1.100",
  "timestamp": "2026-01-14T12:00:00Z",
  "configuration": {
    "sampling_interval": 5,
    "data_retention_days": 30,
    "firmware_version": "1.0.0",
    "hardware_version": "v1.2"
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schema_version` | int | 是 | 协议版本，必须为 2 |
| `ip_address` | string | 否 | 设备当前 IP 地址 |
| `timestamp` | string | 否 | 设备当前时间（ISO8601 格式） |
| `configuration` | object | 否 | 设备配置信息（JSON 对象） |

## 后端使用

### 1. 应用数据库迁移

```bash
python manage.py migrate devices
```

### 2. 启动 MQTT 注册 Worker

```bash
python manage.py mqtt_register_worker
```

这个命令会：
- 订阅 `compostlab/v2/+/register` 主题
- 自动处理设备注册请求
- 自动创建设备（如果不存在）
- 更新设备 IP 地址和配置信息

### 3. （可选）通过 HTTP API 注册

```bash
curl -X POST http://localhost:8000/api/v2/devices/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "schema_version": 2,
    "device_code": "TEST001",
    "ip_address": "192.168.1.100",
    "configuration": {
      "sampling_interval": 5
    }
  }'
```

## 数据库字段

新增字段到 `devices_device` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| `ip_address` | VARCHAR(64) | 设备 IP 地址 |
| `register_at` | TIMESTAMP | 设备首次注册时间 |
| `configuration` | JSONB | 设备配置信息 |

## 响应格式

### 成功响应（新设备）

```json
{
  "device_id": 123,
  "code": "TEST001",
  "name": "TEST001",
  "ip_address": "192.168.1.100",
  "register_at": "2026-01-14 12:00:00",
  "configuration": {
    "sampling_interval": 5
  },
  "registered": false,
  "created_at": "2026-01-14 12:00:00",
  "updated_at": "2026-01-14 12:00:00"
}
```

### 成功响应（已存在设备）

```json
{
  "device_id": 123,
  "code": "TEST001",
  "name": "TEST001",
  "ip_address": "192.168.1.101",
  "register_at": "2026-01-10 10:00:00",
  "configuration": {
    "sampling_interval": 10
  },
  "registered": true,
  "created_at": "2026-01-10 10:00:00",
  "updated_at": "2026-01-14 12:00:00"
}
```

## 设备端实现示例（ESP32 / Arduino）

```cpp
#include <PubSubClient.h>
#include <WiFi.h>
#include <ArduinoJson.h>

const char* mqttServer = "your-mqtt-server";
const int mqttPort = 1883;
const char* mqttUser = "username";
const char* mqttPassword = "password";
const char* deviceCode = "ESP32_001";

WiFiClient espClient;
PubSubClient client(espClient);

void registerDevice() {
  StaticJsonDocument<512> doc;
  doc["schema_version"] = 2;
  doc["ip_address"] = WiFi.localIP().toString();
  doc["timestamp"] = getISO8601Time();

  JsonObject config = doc.createNestedObject("configuration");
  config["sampling_interval"] = 5;
  config["firmware_version"] = "1.0.0";

  String topic = "compostlab/v2/" + String(deviceCode) + "/register";
  String payload;
  serializeJson(doc, payload);

  client.publish(topic.c_str(), payload.c_str(), true);
}

void setup() {
  // ... WiFi 连接和 MQTT 初始化
  registerDevice();
}

void loop() {
  client.loop();
  // ...
}
```

## 注意事项

1. **Topic 格式必须严格匹配**：`compostlab/v2/{device_code}/register`
2. **device_code 从 topic 提取**：不需要在 payload 中重复，但为了兼容性也可以提供
3. **IP 地址会自动更新**：每次注册都会更新 `ip_address` 字段
4. **配置信息完全覆盖**：新的 `configuration` 会完全替换旧的
5. **设备自动创建**：如果设备不存在，会自动创建并设置为 `is_active=true`

## 与遥测 Worker 的关系

- `mqtt_worker`: 处理遥测数据 (`compostlab/v2/+/telemetry`)
- `mqtt_register_worker`: 处理设备注册 (`compostlab/v2/+/register`)

两者可以同时运行，互不干扰。

## 环境变量配置

在 `.env` 或 `docker-compose.yml` 中配置：

```yaml
environment:
  - MQTT_HOST=your-mqtt-server
  - MQTT_PORT=1883
  - MQTT_USER=username
  - MQTT_PASS=password
  - MQTT_REGISTER_TOPIC=compostlab/v2/+/register  # 可选，默认值
```
