# 设备配置管理功能说明

## 概述

设备配置管理功能允许通过 Control 页面查看、编辑和下发设备配置。配置信息通过设备上线时的 MQTT 注册消息保存到数据库，然后可以通过前端界面进行管理和更新。

## 设计原则

**⚠️ 重要：支持多种设备类型**

本系统支持**多种设备类型**，每种设备可能有**完全不同的配置结构**。因此采用**动态配置**设计：

- 前端**不预设固定的配置字段**
- 配置结构完全由设备上报的 `configuration` 决定
- 前端自动解析并展示当前配置
- 支持通用的 JSON 编辑和字段快速编辑

## 功能架构

### 1. 设备上线注册

**MQTT Topic:** `compostlab/v2/{device_code}/register`

**Payload 格式:**
```json
{
  "schema_version": 2,
  "ip_address": "192.168.1.100",
  "timestamp": "2026-01-14T12:00:00Z",
  "configuration": {
    // ⚠️ 这里的配置结构完全取决于设备类型
    // 以下只是示例配置（智能堆肥设备）
    "wifi": {
      "ssid": "Compostlab",
      "password": "znxk8888"
    },
    "mqtt": {
      "server": "118.25.108.254",
      "port": 1883,
      "user": "equipment",
      "pass": "ZNXK8888",
      "device_code": "CP500-VT001"
    },
    "post_interval": 60000,
    "ntp_host": [
      "ntp.ntsc.ac.cn",
      "ntp.aliyun.com"
    ],
    "temp_limitout_max": 65,
    "temp_limitin_max": 70,
    "bath_setpoint": {
      "enabled": true,
      "target": 65.0,
      "hyst": 0.8
    }
  }
}
```

**不同设备类型的配置示例：**

#### 设备类型 A：智能堆肥设备
```json
{
  "wifi": { "ssid": "...", "password": "..." },
  "mqtt": { "server": "...", "port": 1883 },
  "post_interval": 60000,
  "temp_limitout_max": 65,
  "bath_setpoint": { "enabled": true, "target": 65.0 }
}
```

#### 设备类型 B：温度传感器设备
```json
{
  "sample_interval": 5000,
  "report_interval": 30000,
  "sensor_type": "DS18B20",
  "calibration_offset": 0.5
}
```

#### 设备类型 C：环境监测设备
```json
{
  "sensors": ["temperature", "humidity", "co2"],
  "upload_interval": 60000,
  "power_save_mode": true,
  "battery_threshold": 20
}
```

### 2. 前端界面

#### 设备详情页 (`/devices/[id]`)
在设备信息卡片中显示：
- **IP 地址**: 设备上线时的 IP 地址
- **注册时间**: 设备首次注册时间
- **最后上线**: 设备最后上线时间

#### 控制页面 (`/devices/[id]/control`)

控制页面分为三个标签页：

##### 2.1 快捷控制 (Quick Control)
- **快捷控制**: 快速开关水泵等设备
- **快捷配置更新**: 常用配置项的快速设置
  - post_interval (数据上传间隔)
  - read_interval (数据读取间隔)
  - pump_run_time (水泵运行时间)

##### 2.2 完整配置 (Full Configuration)
- **设备注册信息**: 显示 IP 地址、注册时间、最后上线时间
- **当前配置**: 显示设备完整的 configuration JSON
  - 点击"编辑配置"按钮打开配置编辑器
  - 可以查看和编辑完整的设备配置
  - 支持任意 JSON 结构（适配不同设备类型）

##### 2.3 高级配置 (Advanced Configuration) - ⚠️ 动态生成
根据当前设备的 `configuration` **动态生成**界面：

**当前配置结构**
- 显示配置的顶层字段及其类型
- 可折叠查看每个字段的内容
- 适用于复杂配置的快速浏览

**快速编辑常用字段**
- 自动解析当前配置的所有简单字段（字符串、数字、布尔值）
- 为每个字段生成对应的输入控件
  - 布尔值 → 下拉选择框（true/false）
  - 数字 → 数字输入框
  - 字符串 → 文本输入框
- 嵌套对象和数组显示为预览，提示用户在"完整配置"中编辑
- 只发送有修改的字段（部分更新）

## 配置下发流程

### 1. 查看当前配置
```
设备详情 → IP 地址/注册时间
控制页面 → "完整配置" 标签 → 查看当前配置 JSON
```

### 2. 编辑配置
```
控制页面 → "完整配置" 标签 → 点击"编辑配置"
```
在弹出的 Modal 中编辑 JSON 配置。

### 3. 下发配置
编辑完成后，点击"下发配置"按钮，系统会：
1. 验证 JSON 格式
2. 构造 `config_update` 命令
3. 通过 MQTT 发布到设备的 response_topic

**命令格式:**
```json
{
  "commands": [
    {
      "config": {
        "pump_run_time": 60000,
        "read_interval": 120000
      },
      "command": "config_update"
    }
  ]
}
```

### 4. 查看命令历史
在控制页面底部的"命令历史"表格中查看：
- 命令状态 (sent/acked/failed)
- 命令内容
- 发送时间
- Payload 详情

## 部分更新 vs 全部更新

### 部分更新（推荐）
只发送需要修改的字段：
```json
{
  "commands": [
    {
      "config": {
        "post_interval": 60000
      },
      "command": "config_update"
    }
  ]
}
```

设备会将新配置合并到现有配置中，其他字段保持不变。

### 全部更新
发送完整的配置 JSON：
```json
{
  "commands": [
    {
      "config": {
        "wifi": { "ssid": "xxx", "password": "xxx" },
        "mqtt": { ... },
        "post_interval": 60000,
        ...
      },
      "command": "config_update"
    }
  ]
}
```

## 数据库字段

### Device 模型新增字段

```python
ip_address = models.CharField(max_length=64, blank=True, default="")
register_at = models.DateTimeField(null=True, blank=True)
configuration = models.JSONField(default=dict, blank=True)
```

### API 响应

`GET /api/v2/devices` 返回:
```json
{
  "device_id": 1,
  "code": "TEST001",
  "name": "Test Device",
  "ip_address": "192.168.1.100",
  "register_at": "2026-01-14 12:00:00",
  "last_seen_at": "2026-01-14 15:30:00",
  "configuration": {
    "wifi": { ... },
    "mqtt": { ... },
    ...
  },
  ...
}
```

## 使用示例

### 示例 1: 快捷更新采样间隔
1. 访问控制页面
2. 选择"快捷控制"标签
3. 修改 `post_interval_min` 为 5（分钟）
4. 点击 "Apply"
5. 系统下发 `config_update` 命令，只更新 `post_interval` 字段

### 示例 2: 更新 WiFi 配置
1. 访问控制页面
2. 选择"高级配置"标签
3. 展开"WiFi 配置"
4. 输入新的 SSID 和密码
5. 点击"应用 WiFi 配置"
6. 系统下发 `config_update` 命令，更新 `wifi` 字段

### 示例 3: 批量更新多个配置项（使用高级配置）
1. 访问控制页面
2. 选择"高级配置"标签
3. 展开"快速编辑常用字段"
4. 找到需要修改的字段，输入新值
5. 点击"应用更改"
6. 系统只发送有修改的字段（部分更新）

### 示例 4: 编辑复杂嵌套配置
1. 访问控制页面
2. 选择"完整配置"标签
3. 点击"编辑配置"
4. 在编辑器中修改嵌套对象：
```json
{
  "post_interval": 30000,
  "read_interval": 60000,
  "bath_setpoint": {
    "enabled": true,
    "target": 68.0,
    "hyst": 1.0
  }
}
```
5. 点击"下发配置"
6. 系统下发完整的 `config` 对象

### 示例 5: 处理新设备类型
假设新接入一个温湿度传感器设备，配置如下：
```json
{
  "sample_interval": 5000,
  "report_interval": 60000,
  "sensor_type": "DHT22",
  "calibration_offset": 0.5
}
```

**操作步骤：**
1. 设备上线后，访问控制页面
2. 查看完整配置标签，确认配置结构
3. 使用高级配置标签快速编辑简单字段（如 `sample_interval`）
4. 如需修改复杂配置，使用完整配置的 JSON 编辑器
5. 发送配置更新命令

**注意：** 无需修改前端代码，系统会自动适配新的配置结构！

## 注意事项

### 通用注意事项
1. **JSON 格式**: 编辑配置时必须保证 JSON 格式正确
2. **字段类型**: 数值类型不要加引号，字符串类型要加引号
3. **部分更新**: 建议只发送需要修改的字段，避免覆盖其他配置
4. **设备响应**: 设备接收到 `config_update` 命令后应回复 ACK
5. **配置验证**: 设备端应验证配置的有效性（如端口范围、温度限制等）
6. **配置备份**: 建议设备在更新配置前先备份当前配置
7. **MQTT Topic**: 配置更新命令会发布到 `devices/{device_code}/response` 主题

### 多设备类型特别说明
1. **配置结构差异**: 不同设备类型的配置结构可能完全不同
   - 不要假设所有设备都有相同的字段
   - 前端界面会根据实际配置动态生成

2. **配置兼容性**: 新设备上线时会完整上报其配置
   - 系统会自动保存并在前端显示
   - 无需为每种设备类型编写专门的配置界面

3. **配置更新**: 更新配置时只发送需要修改的字段
   - 设备会将新配置与现有配置合并
   - 保持其他字段不变

4. **嵌套配置**: 复杂的嵌套配置建议使用"完整配置"的 JSON 编辑器
   - 高级配置标签主要用于快速编辑简单字段
   - 嵌套对象和数组会显示为预览，引导用户到 JSON 编辑器

## 相关文件

### 后端
- `apps/devices/models.py` - Device 模型
- `apps/devices/api.py` - DeviceRegisterView 接口
- `apps/telemetry/management/commands/mqtt_register_worker.py` - MQTT 注册 Worker
- `apps/devices/services/device_register.py` - 设备注册服务

### 前端
- `frontend/src/app/(main)/devices/[id]/page.tsx` - 设备详情页
- `frontend/src/app/(main)/devices/[id]/control/page.tsx` - 控制页面
- `frontend/src/types/api.ts` - TypeScript 类型定义

## 测试

### 测试设备注册
```bash
# 测试智能堆肥设备
mosquitto_pub -h 118.25.108.254 -p 1883 \
  -u admin -P 'L05b03j..' \
  -t "compostlab/v2/SMART001/register" \
  -m '{
    "schema_version": 2,
    "ip_address": "192.168.1.100",
    "configuration": {
      "wifi": { "ssid": "Compostlab", "password": "xxx" },
      "mqtt": { "server": "118.25.108.254", "port": 1883 },
      "post_interval": 60000,
      "temp_limitout_max": 65,
      "bath_setpoint": { "enabled": true, "target": 65.0 }
    }
  }'

# 测试温湿度传感器设备
mosquitto_pub -h 118.25.108.254 -p 1883 \
  -u admin -P 'L05b03j..' \
  -t "compostlab/v2/TEMP001/register" \
  -m '{
    "schema_version": 2,
    "ip_address": "192.168.1.101",
    "configuration": {
      "sample_interval": 5000,
      "report_interval": 30000,
      "sensor_type": "DHT22",
      "calibration_offset": 0.5
    }
  }'
```

### 测试配置下发
1. 在控制页面编辑配置
2. 点击"下发配置"（完整配置）或"应用更改"（高级配置）
3. 检查命令历史中的状态
4. 使用 MQTT 客户端订阅设备的 response_topic 查看命令是否发送成功

### 测试动态配置适配
1. 上报不同类型的设备配置
2. 访问各设备的控制页面
3. 确认界面正确显示配置结构
4. 尝试编辑不同类型的配置字段
