# CompostLab V2 技术说明

> 文档入口请见：[README.md](../README.md)

## 1. 项目概述

`backend_v2` 是一个围绕堆肥实验场景构建的完整软硬件协同系统，覆盖以下链路：

- 设备端固件：
  - `CP500` 堆肥桶控制器
  - `MMCGS` 多点气体采样/检测控制器
  - `SmartCompost` 智能堆肥监测终端
- 后端服务：
  - Django 6 + Django REST Framework
  - TimescaleDB / PostgreSQL 时序数据存储
  - MQTT 接入、设备注册、自动控制与脚本执行
- 前端控制台：
  - Next.js 16 + React 19 + Ant Design 6
  - 仪表盘、设备管理、批次管理、数据探索、控制脚本、公告与用户管理
- 模型与自动控制：
  - Python 控制脚本
  - 演示模型与 CSV 训练脚本

这个项目的核心目标不是单纯“采数”，而是提供一套可落地的实验数字化平台：

- 设备自动注册与在线监控
- 遥测数据采集、聚合、可视化与导出
- 实验批次、时间窗、设备归属管理
- 控制命令下发与执行回执
- 规则/脚本/模型驱动的自动控制

---

## 2. 技术架构

### 2.1 总体架构

系统按四层组织：

1. 设备固件层  
   ESP32 设备采集传感器数据、执行本地控制逻辑，并通过 MQTT 与平台通信。

2. 接入与控制层  
   后端通过 MQTT worker 接收遥测、注册消息与控制回执，并将控制命令入队/下发。

3. 数据与业务层  
   Django 提供设备、通道、批次、公告、用户、脚本、执行记录、遥测查询等 REST API。

4. 展示与操作层  
   Next.js 前端提供实验控制台，支持不同角色完成监控、配置、脚本编排与数据分析。

### 2.2 主要技术选型

后端：

- Python 3.12
- Django 6
- Django REST Framework
- SimpleJWT
- psycopg 3
- paho-mqtt
- pandas / numpy / scikit-learn / joblib
- gunicorn / uvicorn

前端：

- Next.js 16.1.1
- React 19.2.3
- TypeScript
- Ant Design 6.1.4
- TanStack Query
- Axios
- Day.js
- ECharts

数据库与基础设施：

- TimescaleDB（基于 PostgreSQL）
- Docker Compose
- MQTT Broker（当前部署配置指向外部 MQTT 服务）

---

## 3. 仓库结构

项目根目录关键内容如下：

```text
backend_v2/
├─ apps/                      Django 业务应用
├─ arduino_equipments/        设备固件工程
├─ compostlab_v2/             Django 项目配置
├─ frontend/                  Next.js 前端
├─ media/                     媒体/上传资源（开发时）
├─ models/                    控制模型文件目录
├─ run_attachments/           批次附件目录
├─ scripts/                   模型构建/训练脚本
├─ tests/                     测试目录
├─ docker-compose.yml         容器编排
├─ Dockerfile.backend         后端镜像构建
├─ manage.py                  Django 管理入口
├─ requirements.txt           Python 依赖
├─ deploy.sh                  部署辅助脚本
└─ README.md                  旧部署说明（当前有编码污染）
```

---

## 4. 后端说明

## 4.1 Django 应用划分

`apps/` 下主要模块：

- `accounts`
  - 登录、刷新 token、登出、当前用户
  - 修改密码
  - 用户管理
  - 审计日志

- `announcements`
  - 公告 CRUD
  - 我的公告、已读历史、未读计数

- `devices`
  - 设备、通道、控制模板
  - 控制脚本模板
  - 脚本执行记录
  - 运行时状态
  - 设备注册
  - 自动控制 worker

- `runs`
  - 实验批次
  - 批次时间窗
  - 批次遥测汇总/导出
  - 批次附件

- `telemetry`
  - 原始遥测包
  - 结构化时序值
  - 最新值/区间查询/导出
  - MQTT worker

- `permissions`
  - 权限相关扩展逻辑

- `api`
  - 当前看起来较轻，主要通用 API 结构已经分散到各模块

## 4.2 API 入口

主 URL 配置在 [urls.py](/d/PythonProject/backend_v2/compostlab_v2/urls.py)。

已挂载的 API：

- `api/v2/` + `apps.accounts.urls`
- `api/v2/` + `apps.devices.urls`
- `api/v2/` + `apps.runs.urls`
- `api/v2/` + `apps.telemetry.urls`
- `api/v2/announcements/` + `apps.announcements.urls`

其他入口：

- `admin/` Django Admin
- `healthz` 健康检查

## 4.3 设备域模型

核心模型位于 [models.py](/d/PythonProject/backend_v2/apps/devices/models.py)。

### `Device`

表示一个逻辑设备。

关键字段：

- `code`：设备唯一公开标识
- `name`：显示名称
- `api_token`：自动生成
- `is_active`
- `post_topic`
- `response_topic`
- `meta`
- `last_seen_at`
- `ip_address`
- `register_at`
- `configuration`

用途：

- 设备主档案
- 设备在线状态判断
- 控制与展示配置承载

### `Channel`

表示设备下的一个测量/控制通道。

关键字段：

- `device`
- `code`
- `name`
- `unit`
- `metric`
- `role`
- `display_name`
- `meta`

特点：

- `device + code` 唯一
- 已经支持语义层字段，不必完全依赖 `code` 猜测类型

### `DeviceCommand`

表示发给设备的命令记录。

关键字段：

- `device`
- `command`
- `payload`
- `status`
- `sent_at`
- `acked_at`
- `result`

用途：

- 追踪命令生命周期
- 支撑控制历史和调试

### `ControlTemplate`

用于保存常用控制命令模板。

### `ScriptTemplate`

用于自动控制脚本。

支持类型：

- `threshold`
- `schedule`
- `hybrid`
- `python`

核心字段：

- `threshold_config`
- `schedule_config`
- `python_code`
- `command_template`
- `devices`
- `run`
- `priority`
- `is_active`

### `ScriptExecution`

记录每次脚本执行情况。

### `ScriptRuntimeState`

保存“脚本 + 设备”维度的持久化运行状态。

这部分是当前自动控制能力里非常重要的一层，允许脚本保存：

- 计数器
- 阶段状态
- 冷却时间
- 累计变量

也就是你前面提到的“按脚本 + 设备持久化”的基础。

## 4.4 遥测模型

位于 [models.py](/d/PythonProject/backend_v2/apps/telemetry/models.py)。

### `TelemetryRaw`

保存原始遥测包。

关键字段：

- `device`
- `topic`
- `ts_received`
- `payload`
- `payload_hash`
- `source`

用途：

- 原始包留档
- 调试设备协议
- 去重与追溯

### `TelemetryKV`

保存结构化后的时序点。

关键字段：

- `device`
- `code`
- `ts`
- `value`
- `unit`
- `quality_flag`
- `source`
- `meta`

特点：

- 多组围绕 `device + code + ts` 的索引
- 已按“最新值查询、区间查询、跨设备查询”优化

## 4.5 批次模型

位于 [models.py](/d/PythonProject/backend_v2/apps/runs/models.py)。

### `Run`

表示一个实验批次。

字段：

- `name`
- `start_at`
- `end_at`
- `recipe`
- `settings`
- `note`

### `RunWindow`

表示批次下某一时间窗内，哪些设备属于哪个组。

字段：

- `run`
- `devices`：ManyToMany
- `start_at`
- `end_at`
- `follow_run`
- `group`
- `treatment`
- `settings`
- `meta`
- `note`

这个模型很关键，因为它把“实验设计”与“设备时序数据”关联起来了。

### `RunAttachment`

用于保存：

- 理化数据
- 实验方案
- 报告
- 其他附件

## 4.6 鉴权与用户

`accounts` 模块提供：

- `auth/login`
- `auth/refresh`
- `auth/logout`
- `auth/me`
- `auth/change-password`
- `auth/my-logs`

管理员能力：

- 用户列表/创建/详情/修改
- 启停用户
- 审计日志

## 4.7 公告系统

`announcements` 提供：

- 公告列表/创建/修改/删除
- 我的公告
- 已读历史
- 标记已读
- 未读计数

## 4.8 设备 API

`apps/devices/urls.py` 是后端最核心的一组 API。

主要能力：

- 设备 CRUD
- 设备树 `devices/tree`
- 通道 CRUD
- 通道按 code 查询/upsert
- 设备命令列表与创建
- 控制模板 CRUD
- 控制脚本模板 CRUD
- 脚本执行记录查询
- 脚本运行时状态
- 模型注册表与模型健康检查
- 手动触发阈值检查
- 手动触发定时检查
- 设备注册

## 4.9 遥测 API

`apps/telemetry/urls.py` 提供：

- 多设备查询 `telemetry`
- 单设备区间遥测
- 单通道区间遥测
- 设备最新值
- 通道最新值
- 设备 summary
- 设备导出

## 4.10 批次 API

`apps/runs/urls.py` 提供：

- 批次 CRUD
- 时间窗 CRUD
- 批次遥测
- 批次 summary
- 导出与宽表导出
- 批次附件管理

---

## 5. 自动控制与脚本体系

当前项目的自动控制不是单一规则引擎，而是多层能力叠加：

### 5.1 阈值规则

基于某个指标、比较符和阈值触发动作。

### 5.2 定时规则

按 cron 或调度配置执行。

### 5.3 Python 脚本规则

支持写 Python 控制脚本。

这类脚本可以：

- 获取最新值
- 获取历史数据
- 组合多条件决策
- 控制多个设备
- 调用模型预测
- 读写持久化 runtime state

### 5.4 运行时持久化

`ScriptRuntimeState` 提供脚本变量存储。

适用场景：

- 每次运行计数 +1
- 状态机阶段推进
- 防抖计时
- 条件累计

### 5.5 模型支持

`models/` 目录用于保存控制脚本使用的模型文件。

当前说明位于 [README.md](/d/PythonProject/backend_v2/models/README.md)。

已有示例：

- `cp500_demo_control_v1.pkl`

相关脚本：

- [build_demo_control_model.py](/d/PythonProject/backend_v2/scripts/build_demo_control_model.py)
- [train_control_model_from_csv.py](/d/PythonProject/backend_v2/scripts/train_control_model_from_csv.py)

默认特征列：

- `temp_avg_5m`
- `o2_min_5m`
- `sample_count_temp`
- `sample_count_o2`

标签列：

- `decision`

---

## 6. 设备固件说明

设备固件位于 `arduino_equipments/`，每种设备一个 PlatformIO 工程。

## 6.1 CP500

目录：

- [esp32-cp500-v3](/d/PythonProject/backend_v2/arduino_equipments/esp32-cp500-v3)

定位：

- 堆肥桶控制器
- 控制加热、水泵、曝气
- 采集内桶温度、水箱温度、外壁温度

关键能力：

- 本地自动控制
- 手动命令
- 配置更新
- 急停
- MQTT 遥测与注册

典型通道：

- `TempIn`
- `TempOut1`
- `TempOut2`
- `TempOut3`
- `TankTemp`
- `Heater`
- `Pump`
- `Aeration`
- `EmergencyState`

## 6.2 MMCGS

目录：

- [esp32-MMCGS](/d/PythonProject/backend_v2/arduino_equipments/esp32-MMCGS)

定位：

- 多点位气体采样控制器
- 一个控制器带多个点位（例如 `MMCGS001-P1 ~ P6`）

典型点位上报指标：

- `CO2`
- `CO`
- `H2S`
- `O2`
- `CH4`
- `AirTemp`
- `AirHumidity`

特点：

- 控制器与点位是“一对多”关系
- 平台端已针对该模式做了分组展示

## 6.3 SmartCompost

目录：

- [esp32-smartCompost](/d/PythonProject/backend_v2/arduino_equipments/esp32-smartCompost)

定位：

- 面向较轻量的堆肥监测场景

典型上报指标：

- `CO2`
- `O2`
- `RoomTemp`
- `AirTemp`
- `AirHumidity`

---

## 7. 前端说明

## 7.1 技术栈

前端位于 `frontend/`：

- Next.js App Router
- React 19
- TypeScript
- Ant Design
- React Query
- ECharts

## 7.2 页面结构

关键页面位于 `frontend/src/app/(main)/`：

- [page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/page.tsx)
  - 仪表盘
- [devices/page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/devices/page.tsx)
  - 设备列表
- [devices/[id]/page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/devices/[id]/page.tsx)
  - 设备详情
- [scripts/page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/scripts/page.tsx)
  - 控制脚本
- [runs/page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/runs/page.tsx)
  - 运行批次
- [runs/[id]/page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/runs/[id]/page.tsx)
  - 批次详情
- [telemetry/page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/telemetry/page.tsx)
  - 数据探索
- `announcements/*`
  - 公告
- `users/page.tsx`
  - 用户管理
- `audit-logs/page.tsx`
  - 审计日志
- `usage/page.tsx`
  - 使用说明

## 7.3 目录组织

`frontend/src/features/` 是按业务模块拆分的查询/变更层：

- announcements
- channels
- devices
- runs
- runWindows
- telemetry
- templates
- users

`frontend/src/lib/` 是前端通用逻辑：

- `api.ts`
- `auth.ts`
- `alerts.ts`
- `deviceRules.ts`
- `metrics.ts`
- `channelGroups.ts`
- `status.ts`

## 7.4 前端当前重点模块

### 仪表盘

特点：

- 设备分 profile 展示
- MMCGS 分组控制器卡
- CP500 特制示意图卡
- 在线/告警状态概览

### 设备详情页

特点：

- 兼顾普通研究人员与开发者
- 控制参数面板
- 控制脚本入口
- 遥测与配置协同

### 控制脚本页

特点：

- 已逐步演化成统一规则编辑器
- 支持阈值、定时、脚本、模型控制
- 支持跨设备动作
- 支持 Python 脚本预览

---

## 8. 数据流说明

## 8.1 设备上电流程

1. ESP32 加载本地配置
2. 连接 WiFi
3. 同步 NTP
4. 连接 MQTT
5. 发送 `register` 消息
6. 周期发送 `telemetry` 消息

## 8.2 注册消息

注册消息用于：

- 设备上线登记
- 平台同步设备当前配置
- 记录设备 IP、时间、主题等元信息

## 8.3 遥测入库流程

1. MQTT worker 收到遥测
2. 解析 topic 和 payload
3. 写入 `TelemetryRaw`
4. 将 `channels` 数组拆成 `TelemetryKV`
5. 更新设备 `last_seen_at`
6. 必要时补充/更新设备通道字典

## 8.4 控制下发流程

1. 前端调用设备命令或脚本 API
2. 后端创建 `DeviceCommand` 或 `ScriptExecution`
3. 通过 MQTT 响应主题下发给设备
4. 设备执行并回执
5. 后端更新状态

## 8.5 自动控制流程

1. `auto_control_worker` 周期运行
2. 读取启用中的脚本/规则
3. 获取设备最新值/历史值
4. 判断阈值或执行 Python 脚本
5. 生成命令
6. 保存执行记录
7. 下发控制命令

---

## 9. Docker 与部署

## 9.1 容器服务

当前 [docker-compose.yml](/d/PythonProject/backend_v2/docker-compose.yml) 定义：

- `db`
  - TimescaleDB
- `backend`
  - Django API
- `migrate`
  - 数据库迁移任务
- `mqtt_worker`
  - 遥测接收 worker
- `mqtt_register_worker`
  - 注册消息 worker
- `auto_control_worker`
  - 自动控制 worker
- `frontend`
  - Next.js 前端

## 9.2 端口

- `5432`：数据库
- `8001 -> 8000`：后端
- `3000`：前端

## 9.3 健康检查

- 数据库：`pg_isready`
- 后端：`GET /healthz`

## 9.4 部署说明

当前仓库自带：

- [deploy.sh](/d/PythonProject/backend_v2/deploy.sh)
- [docker-compose.yml](/d/PythonProject/backend_v2/docker-compose.yml)
- [Dockerfile.backend](/d/PythonProject/backend_v2/Dockerfile.backend)
- [frontend/Dockerfile](/d/PythonProject/backend_v2/frontend/Dockerfile)

注意：

- 当前根目录 `README.md` 主要是旧部署说明，但存在编码污染
- 本文档可视为更可靠的项目总说明

---

## 10. 环境变量与配置

## 10.1 后端

后端主要通过：

- `.env.backend`

承载配置。

通常包括：

- 数据库连接
- JWT / Django 配置
- MQTT 配置
- 文件存储相关配置

## 10.2 前端

前端主要通过：

- `frontend/.env.production`

承载配置。

核心变量包括：

- `NEXT_PUBLIC_API_BASE`
- `NEXT_PUBLIC_SITE_URL`

## 10.3 设备侧配置

设备各自有：

- `data/config.json`

用于 WiFi、MQTT、采样周期、控制参数等配置。

---

## 11. 常见开发任务

## 11.1 本地启动后端

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

## 11.2 本地启动前端

```bash
cd frontend
npm install
npm run dev
```

## 11.3 Docker 启动

```bash
docker compose up -d
```

## 11.4 执行迁移

```bash
python manage.py migrate
```

或容器内：

```bash
docker compose exec backend python manage.py migrate
```

## 11.5 自动控制与 MQTT 相关管理命令

可见于：

- `apps/devices/management/commands/auto_control_worker.py`
- `apps/telemetry/management/commands/mqtt_worker.py`
- `apps/telemetry/management/commands/mqtt_register_worker.py`

常见启动方式：

```bash
python manage.py auto_control_worker
python manage.py mqtt_worker
python manage.py mqtt_register_worker
```

---

## 12. 当前业务特性总结

这是一个高度定制化的平台，以下是当前已经具备、并且后续维护时要特别注意保持一致的业务特性：

- 设备类型已经不仅靠前端猜测，也逐步支持在设备配置中明确指定
- MMCGS 控制器支持“控制器 + 点位”双层展示逻辑
- CP500 仪表盘卡片使用了定制示意图而不是纯表格
- 控制脚本页已经逐步演化为统一规则编辑器
- Python 脚本支持模型调用与运行时持久化
- 设备配置更新已经强调“仅传修改项”，避免把密码掩码回传设备
- CP500 的告警逻辑已补充“水箱与外壁温差过大”场景

---

## 13. 已知问题与维护建议

## 13.1 已知问题

从当前仓库状态看，至少存在以下维护风险：

- 多份旧文档存在编码污染
- 某些中文字符串在源码中仍可能残留乱码
- 设备 profile 推断与业务规则虽然已经集中，但仍需避免前后端再次分叉
- 仪表盘页面逻辑较重，建议继续拆组件
- 脚本页功能非常强，但复杂度已高，后续要继续做结构收敛

## 13.2 维护建议

1. 优先统一文本编码为 UTF-8。  
2. 继续把设备规则集中到共享规则源。  
3. 把 dashboard / scripts 页面逐步拆分为更小组件。  
4. 对设备协议、配置字段、脚本变量、模型接口补自动化测试。  
5. 对“配置同步”“脚本执行”“MQTT worker”增加更多链路日志。  

---

## 14. 推荐阅读顺序

如果是第一次接手本项目，建议按下面顺序阅读：

1. 本文档
2. [docker-compose.yml](/d/PythonProject/backend_v2/docker-compose.yml)
3. [models.py](/d/PythonProject/backend_v2/apps/devices/models.py)
4. [models.py](/d/PythonProject/backend_v2/apps/telemetry/models.py)
5. [page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/page.tsx)
6. [page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/devices/[id]/page.tsx)
7. [page.tsx](/d/PythonProject/backend_v2/frontend/src/app/(main)/scripts/page.tsx)
8. `arduino_equipments/` 下对应设备 README 与 `src/main.cpp`

---

## 15. 文档定位

这份文档的目标不是替代所有细节文档，而是作为：

- 项目总览
- 新成员接手手册
- 二次开发入口
- 后续重构与补文档的基线

如果后续你愿意，下一步最值得做的是把这份总说明继续拆成三份独立文档：

- `docs/backend.md`
- `docs/frontend.md`
- `docs/devices.md`

这样维护起来会更轻松，也更适合长期演进。
