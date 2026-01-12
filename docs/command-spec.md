# 设备控制命令规范

## 概述

本文档定义了 CompostLab 系统中设备控制命令的标准格式。系统通过继电器控制各类设备（水泵、风扇、阀门、加热器等），所有设备本质上都是开关量控制。所有脚本（阈值触发、定时执行、Python 脚本）都必须使用此格式来发送控制指令给设备。

## 1. 命令格式

### 1.1 基本格式

```json
{
  "commands": [
    {
      "command": "pump",
      "action": "on",
      "duration": 60000
    }
  ]
}
```

### 1.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `commands` | Array | 是 | 命令数组，支持同时发送多个命令 |
| `commands[].command` | String | 是 | 命令类型，见下方支持的命令列表 |
| `commands[].action` | String | 是 | 动作类型：`"on"` 开启（继电器闭合），`"off"` 关闭（继电器断开） |
| `commands[].duration` | Number | 否 | 持续时间（毫秒），不指定则永久执行 |

## 2. 支持的命令类型

所有命令都是简单的开关控制，通过继电器实现。

### 2.1 泵控制 (pump)

控制水泵的开关。

```json
{
  "commands": [
    {
      "command": "pump",
      "action": "on",
      "duration": 60000
    }
  ]
}
```

**示例：**
```json
// 开启水泵运行 60 秒
{
  "commands": [
    {
      "command": "pump",
      "action": "on",
      "duration": 60000
    }
  ]
}

// 关闭水泵
{
  "commands": [
    {
      "command": "pump",
      "action": "off"
    }
  ]
}
```

### 2.2 风扇控制 (fan)

控制风扇的开关。

```json
{
  "commands": [
    {
      "command": "fan",
      "action": "on",
      "duration": 120000
    }
  ]
}
```

**示例：**
```json
// 开启风扇运行 2 分钟
{
  "commands": [
    {
      "command": "fan",
      "action": "on",
      "duration": 120000
    }
  ]
}

// 关闭风扇
{
  "commands": [
    {
      "command": "fan",
      "action": "off"
    }
  ]
}
```

### 2.3 阀门控制 (valve)

控制各类阀门（电磁阀、球阀等）的开闭。

```json
{
  "commands": [
    {
      "command": "valve",
      "action": "on",
      "duration": 30000
    }
  ]
}
```

**示例：**
```json
// 打开阀门 30 秒
{
  "commands": [
    {
      "command": "valve",
      "action": "on",
      "duration": 30000
    }
  ]
}

// 关闭阀门
{
  "commands": [
    {
      "command": "valve",
      "action": "off"
    }
  ]
}
```

### 2.4 加热器控制 (heater)

控制加热设备的开关。

```json
{
  "commands": [
    {
      "command": "heater",
      "action": "on",
      "duration": 300000
    }
  ]
}
```

**示例：**
```json
// 开启加热器 5 分钟
{
  "commands": [
    {
      "command": "heater",
      "action": "on",
      "duration": 300000
    }
  ]
}

// 关闭加热器
{
  "commands": [
    {
      "command": "heater",
      "action": "off"
    }
  ]
}
```

### 2.5 照明控制 (light)

控制照明设备的开关。

```json
{
  "commands": [
    {
      "command": "light",
      "action": "on"
    }
  ]
}
```

**示例：**
```json
// 开启照明（永久）
{
  "commands": [
    {
      "command": "light",
      "action": "on"
    }
  ]
}

// 关闭照明
{
  "commands": [
    {
      "command": "light",
      "action": "off"
    }
  ]
}
```

### 2.6 搅拌器控制 (mixer)

控制搅拌设备的开关。

```json
{
  "commands": [
    {
      "command": "mixer",
      "action": "on",
      "duration": 60000
    }
  ]
}
```

**示例：**
```json
// 开启搅拌器 1 分钟
{
  "commands": [
    {
      "command": "mixer",
      "action": "on",
      "duration": 60000
    }
  ]
}

// 关闭搅拌器
{
  "commands": [
    {
      "command": "mixer",
      "action": "off"
    }
  ]
}
```

## 3. 组合命令

支持在一个请求中同时发送多个命令，系统将按顺序执行。

```json
{
  "commands": [
    {
      "command": "pump",
      "action": "on",
      "duration": 30000
    },
    {
      "command": "fan",
      "action": "on",
      "duration": 60000
    },
    {
      "command": "valve",
      "action": "on",
      "duration": 30000
    }
  ]
}
```

**执行顺序：** 命令按数组顺序依次执行

## 4. 常用场景示例

### 4.1 高温自动降温

当温度超过 75℃ 时，开启风扇和水泵降温。

```json
{
  "commands": [
    {
      "command": "fan",
      "action": "on",
      "duration": 300000
    },
    {
      "command": "pump",
      "action": "on",
      "duration": 120000
    }
  ]
}
```

### 4.2 定时补水

每天早上 9 点自动开启水泵补水 2 分钟。

```json
{
  "commands": [
    {
      "command": "pump",
      "action": "on",
      "duration": 120000
    }
  ]
}
```

### 4.3 通风搅拌

每天中午 12 点同时开启风扇和搅拌器。

```json
{
  "commands": [
    {
      "command": "fan",
      "action": "on",
      "duration": 300000
    },
    {
      "command": "mixer",
      "action": "on",
      "duration": 300000
    }
  ]
}
```

### 4.4 温度控制

低温时开启加热器，高温时开启降温设备（Python 脚本示例）。

```python
# Python 脚本示例
temp = get_latest_value("temperature")

if temp > 75:
    # 高温：降温和通风
    commands = [
        {"command": "fan", "action": "on", "duration": 300000},
        {"command": "pump", "action": "on", "duration": 120000}
    ]
elif temp < 50:
    # 低温：开启加热器
    commands = [
        {"command": "heater", "action": "on"}
    ]
else:
    # 温度合适：不做操作
    commands = []
```

### 4.5 湿度控制

当湿度超过 80% 时，开启风扇通风。

```json
{
  "commands": [
    {
      "command": "fan",
      "action": "on",
      "duration": 600000
    }
  ]
}
```

### 4.6 完整的堆肥周期控制

基于温度和湿度的复杂控制（Python 脚本）。

```python
# Python 脚本示例
temp = get_latest_value("temperature")
humidity = get_latest_value("humidity")

commands = []

if temp > 75:
    # 高温：降温和通风
    commands = [
        {"command": "fan", "action": "on", "duration": 600000},
        {"command": "pump", "action": "on", "duration": 300000}
    ]
elif temp < 50:
    # 低温：开启加热器
    commands = [
        {"command": "heater", "action": "on"}
    ]
else:
    # 温度合适：定时搅拌
    commands = [
        {"command": "mixer", "action": "on", "duration": 60000}
    ]

# 湿度过高时加强通风
if humidity > 80:
    commands.append({"command": "fan", "action": "on", "duration": 600000})
```

## 5. 时长说明

| 时长（毫秒） | 时长（秒） | 时长（分钟） | 适用场景 |
|--------------|------------|--------------|----------|
| 10000 | 10秒 | - | 短时测试 |
| 30000 | 30秒 | 0.5 | 短时操作、阀门开关 |
| 60000 | 60秒 | 1 | 补水、短时通风 |
| 120000 | 120秒 | 2 | 标准补水时长 |
| 180000 | 180秒 | 3 | 较长补水时长 |
| 300000 | 300秒 | 5 | 通风、搅拌、加热 |
| 600000 | 600秒 | 10 | 长时通风 |
| 不指定 | 永久 | - | 持续开启，直到收到关闭命令 |

## 6. 错误处理

### 6.1 无效命令格式

```json
{
  "error": "Invalid command format",
  "detail": "Missing required field: command"
}
```

### 6.2 不支持的命令类型

```json
{
  "error": "Unsupported command type",
  "detail": "Command 'unknown_cmd' is not supported",
  "supported_commands": ["pump", "fan", "valve", "heater", "light", "mixer"]
}
```

### 6.3 无效动作

```json
{
  "error": "Invalid action",
  "detail": "Action must be 'on' or 'off'"
}
```

## 7. 最佳实践

1. **合理设置 duration**：
   - 短时操作（30秒）：阀门
   - 中等时长（1-2分钟）：补水
   - 标准时长（5分钟）：通风、搅拌、加热
   - 长时操作（10分钟以上）：强通风
   - 永久开启：照明（需谨慎使用）

2. **使用定时关闭**：
   - 避免忘记关闭设备导致过度耗能
   - 防止设备长时间运行过热
   - 水泵务必设置 `duration`，避免泵干运行

3. **合理设置优先级**：
   - 温度控制命令：优先级 80-100
   - 湿度控制命令：优先级 60-80
   - 定时操作命令：优先级 40-60

4. **组合使用命令**：
   - 同时控制多个设备实现复杂逻辑
   - 高温时：fan + pump
   - 通风时：fan + mixer

5. **监控执行结果**：
   - 通过执行记录查看命令执行情况
   - 检查设备是否正确响应
   - 及时调整脚本参数

6. **安全注意事项**：
   - 水泵开启后务必设置 `duration`，避免泵干运行
   - 加热器建议安装温度保护，避免过热
   - 定期检查继电器触点状态

## 8. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 2.1 | 2026-01-11 | 恢复命令类型，但简化为纯开关控制 |
| 2.0 | 2026-01-11 | 简化为继电器控制，专注开关量控制 |
| 1.0 | 2026-01-11 | 初始版本 |

## 9. 联系方式

如有疑问或建议，请联系技术支持。



## 8. 联系方式

如有疑问或建议，请联系技术支持。
