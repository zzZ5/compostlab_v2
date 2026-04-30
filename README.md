# CompostLab V2

CompostLab V2 是一套面向堆肥实验的设备接入、数据采集、实验管理与自动控制平台。

系统由三部分组成：

- 后端：Django + DRF + TimescaleDB
- 前端：Next.js + React + Ant Design
- 设备端：ESP32 固件工程，包含 CP500、MMCGS、SmartCompost

## 文档入口

完整文档已经整理到 `docs/` 目录，常用入口如下：

- [用户使用手册](./docs/user-guide.md)
- [设备说明手册](./docs/device-guide.md)
- [技术说明](./docs/technical-guide.md)
- [部署与运维](./docs/deployment-guide.md)

## 快速启动

使用 Docker：

```bash
docker compose up -d
```

执行数据库迁移：

```bash
docker compose exec backend python manage.py migrate
```

查看服务状态：

```bash
docker compose ps
```

## 常用服务

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8001`
- 健康检查：`http://localhost:8001/healthz`
- Django Admin：`http://localhost:8001/admin/`

## 仓库结构

```text
backend_v2/
├─ apps/                 Django 业务应用
├─ arduino_equipments/   ESP32 设备固件
├─ compostlab_v2/        Django 项目配置
├─ docs/                 文档中心
├─ frontend/             Next.js 前端
├─ models/               控制模型文件
├─ scripts/              模型构建与训练脚本
├─ docker-compose.yml    Docker 编排
└─ manage.py             Django 管理入口
```

## 维护提醒

后续新增设备类型、修改控制脚本能力、调整设备协议或改动部署方式时，请同步更新 `docs/` 中对应文档。
