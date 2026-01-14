# 动态配置管理设计文档

## 设计背景

系统需要支持**多种设备类型**，每种设备可能有**完全不同的配置结构**。传统的"固定字段表单"方式无法满足需求。

## 核心设计原则

1. **不预设配置结构**
   - 前端不硬编码任何配置字段
   - 配置结构完全由设备上报决定
   - 自动适配任意 JSON 结构

2. **通用性与易用性平衡**
   - 完整配置：JSON 编辑器，支持任意复杂结构
   - 快速编辑：动态生成表单，针对简单字段
   - 配置预览：结构化展示当前配置

3. **向后兼容**
   - 新设备类型上线时无需修改代码
   - 自动识别和展示新配置结构
   - 现有设备继续正常工作

## 系统架构

```
┌─────────────┐
│  设备端      │
└──────┬──────┘
       │ MQTT register
       │ { configuration: {...} }
       ↓
┌─────────────────┐
│  后端数据库      │ 保存完整 configuration
└──────┬──────────┘
       │ GET /devices
       ↓
┌─────────────────┐
│  前端界面        │ 动态解析配置
│                 │ 生成相应界面
└──────┬──────────┘
       │ 编辑配置
       │ POST /devices/{id}/commands
       │ { command: "config_update", config: {...} }
       ↓
┌─────────────────┐
│  设备端          │ 合并配置
│                 │ 返回 ACK
└─────────────────┘
```

## 前端界面设计

### 1. 完整配置标签
**用途：** 查看和编辑完整的 JSON 配置

**特点：**
- 显示当前完整的 configuration JSON
- JSON 编辑器支持语法高亮
- 支持任意复杂结构（嵌套对象、数组）
- 格式验证
- 一键下发

**适用场景：**
- 初次查看新设备配置
- 编辑复杂的嵌套配置
- 批量修改多个字段

### 2. 高级配置标签
**用途：** 快速编辑常用简单字段

**特点：**
- **动态生成**：根据当前配置自动生成表单
- **智能识别**：
  - 布尔值 → 下拉选择
  - 数字 → 数字输入框
  - 字符串 → 文本输入框
  - 嵌套对象/数组 → 预览提示
- **部分更新**：只发送有修改的字段
- **配置预览**：折叠查看每个字段内容

**适用场景：**
- 快速修改采样间隔、阈值等简单参数
- 查看配置结构
- 避免编辑复杂 JSON

## 配置更新流程

### 流程图
```
用户操作 → 选择编辑方式
           ├─ 完整配置 → JSON 编辑器 → 验证格式 → 下发
           └─ 高级配置 → 动态表单 → 部分字段 → 下发
                     ↓
                构造 config_update 命令
                     ↓
                POST /devices/{id}/commands
                     ↓
                MQTT publish to response_topic
                     ↓
                设备接收 → 合并配置 → 返回 ACK
```

### 部分更新示例
```json
// 原配置
{
  "post_interval": 60000,
  "read_interval": 120000,
  "wifi": { "ssid": "...", "password": "..." }
}

// 只修改 post_interval
{
  "commands": [
    {
      "config": { "post_interval": 30000 },
      "command": "config_update"
    }
  ]
}

// 设备端合并结果
{
  "post_interval": 30000,      // 已更新
  "read_interval": 120000,    // 保持不变
  "wifi": { ... }             // 保持不变
}
```

## 不同设备类型的配置示例

### 设备类型 1：智能堆肥设备
```json
{
  "wifi": {
    "ssid": "Compostlab",
    "password": "xxx"
  },
  "mqtt": {
    "server": "118.25.108.254",
    "port": 1883,
    "user": "equipment",
    "pass": "xxx"
  },
  "post_interval": 60000,
  "ntp_host": ["ntp.aliyun.com"],
  "temp_limitout_max": 65,
  "bath_setpoint": {
    "enabled": true,
    "target": 65.0
  }
}
```

### 设备类型 2：温湿度传感器
```json
{
  "sample_interval": 5000,
  "report_interval": 30000,
  "sensor_type": "DHT22",
  "calibration_offset": 0.5,
  "power_save_mode": true
}
```

### 设备类型 3：环境监测设备
```json
{
  "sensors": ["temperature", "humidity", "co2", "pm2.5"],
  "upload_interval": 60000,
  "battery_threshold": 20,
  "alarm_enabled": true,
  "alert_recipients": ["admin@example.com"]
}
```

### 设备类型 4：简单开关控制器
```json
{
  "relay_count": 4,
  "default_state": [false, false, false, false],
  "auto_off_delay": 300000
}
```

## 技术实现

### 前端实现要点

#### 1. 动态表单生成
```typescript
// 遍历配置对象，根据值类型生成表单项
Object.entries(configuration).forEach(([key, value]) => {
  if (typeof value === 'boolean') {
    // 生成下拉选择框
  } else if (typeof value === 'number') {
    // 生成数字输入框
  } else if (typeof value === 'string') {
    // 生成文本输入框
  } else {
    // 嵌套对象/数组：显示预览
  }
})
```

#### 2. JSON 编辑器
- 使用 Ant Design 的 Input.TextArea
- 等宽字体
- JSON.parse() 验证格式
- 错误提示

#### 3. 部分更新
```typescript
// 只发送有修改的字段
const config = {};
Object.entries(formData).forEach(([key, value]) => {
  if (value !== undefined && value !== null && value !== "") {
    config[key] = value;
  }
});
```

### 后端实现要点

#### 1. 配置保存
```python
# 在 DeviceRegisterView 中
configuration = body.get("configuration")
if configuration:
    d.configuration = configuration  # 直接保存完整 JSON
```

#### 2. 配置下发
```python
# 复用现有的命令下发接口
POST /devices/{id}/commands
{
  "commands": [
    {
      "command": "config_update",
      "config": { ... }  # 可以是部分字段或完整配置
    }
  ]
}
```

## 优势

### 1. 灵活性
- ✅ 支持任意配置结构
- ✅ 新设备类型无需修改代码
- ✅ 动态适配配置变更

### 2. 易用性
- ✅ 简单字段快速编辑（高级配置）
- ✅ 复杂配置 JSON 编辑（完整配置）
- ✅ 配置结构可视化（预览）

### 3. 可维护性
- ✅ 前端代码不依赖具体配置
- ✅ 减少硬编码，降低耦合
- ✅ 统一的配置管理接口

### 4. 扩展性
- ✅ 支持未来任何新的设备类型
- ✅ 支持配置结构的演进
- ✅ 易于添加新的配置编辑方式

## 最佳实践

### 1. 设备端设计
- ⚠️ 设备上线时必须上报完整配置
- ⚠️ 配置结构要有良好的命名和文档
- ⚠️ 配置更新时要支持部分合并
- ⚠️ 更新失败要回滚到原配置

### 2. 配置设计
- ⚠️ 使用扁平结构优于深层嵌套
- ⚠️ 常用字段放在顶层，便于快速编辑
- ⚠️ 提供合理的默认值
- ⚠️ 添加字段说明注释（可选）

### 3. 用户操作
- ⚠️ 修改前先查看当前配置
- ⚠️ 优先使用"高级配置"编辑简单字段
- ⚠️ 复杂配置使用"完整配置"的 JSON 编辑器
- ⚠️ 修改后检查命令历史确认状态

## 后续优化方向

### 1. 配置模板
- 为常见设备类型提供配置模板
- 一键应用预设配置
- 配置模板库管理

### 2. 配置版本管理
- 记录配置变更历史
- 支持配置回滚
- 配置差异对比

### 3. 配置验证
- 前端实时验证字段范围
- 后端验证配置有效性
- 提供友好的错误提示

### 4. 批量配置
- 多设备批量应用配置
- 配置导入导出
- 配置复制功能
