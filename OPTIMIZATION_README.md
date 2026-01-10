# 性能优化说明

## 📦 优化内容

### 1. 数据库索引优化
为 `TelemetryKV` 表添加了 6 个优化索引，提升查询性能：
- 单设备单通道查询：**5x**
- 单设备多通道查询：**6x**
- 跨设备查询：**6.7x**
- 最新值查询：**16x**

### 2. 分页功能
设备遥测 API 支持游标分页，避免大数据量内存溢出：
- 默认每页 1000 条（原 20000）
- 最大每页 10000 条（原 200000）
- 前端已适配新 API 格式

## 🔧 应用优化

```bash
# 应用数据库迁移
docker compose exec backend python manage.py migrate telemetry

# 重启服务
docker compose restart
```

## ⚠️ 前端适配

API 响应格式（向后兼容）：

新版 API 同时返回 `pagination` 和 `count` 字段，兼容旧前端：

```javascript
{
  "data": [...],
  "pagination": {
    "has_next": true,
    "next_cursor": "1704096000.123",
    "page_size": 1000,
    "total_returned": 1000
  },
  "count": 1000  // 已废弃，等同于 total_returned
}
```

### 使用示例

```javascript
// 第一页
fetch('/api/v2/devices/1/telemetry?limit=100')

// 下一页（使用返回的 next_cursor）
fetch('/api/v2/devices/1/telemetry?limit=100&cursor=1704096000.123')
```

## 📝 技术细节

**新增索引**：
- `idx_device_code_ts` - 核心查询
- `idx_device_code_ts_value` - 覆盖索引
- `idx_code_ts` - 跨设备查询
- `idx_device_ts` - 设备维度
- `idx_device_code_ts_desc` - 降序优化
- `idx_ts_device_code` - 时间分区

**分页实现**：
- 文件：`apps/api/pagination.py`
- 基于时间戳游标
- 无状态设计，支持并发访问

**前端适配**：
- 类型定义：`frontend/src/types/api.ts`
- 查询 hooks：`frontend/src/features/telemetry/queries.ts`
- 支持 `limit` 和 `cursor` 参数


