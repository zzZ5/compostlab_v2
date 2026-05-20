# 部署与运维

## 1. 部署方式概览

项目当前推荐使用 Docker Compose 部署。Compose 会启动：

- `db`：TimescaleDB / PostgreSQL
- `backend`：Django API 服务
- `migrate`：数据库迁移任务
- `mqtt_worker`：遥测接收 worker
- `mqtt_register_worker`：设备注册 worker
- `auto_control_worker`：自动控制 worker
- `frontend`：Next.js 前端

配置文件：

- [docker-compose.yml](../docker-compose.yml)
- [Dockerfile.backend](../Dockerfile.backend)
- [frontend/Dockerfile](../frontend/Dockerfile)

## 2. 环境变量

后端配置：

- `.env.backend`

前端配置：

- `frontend/.env.production`

Compose 变量：

- 根目录 `.env` 或启动命令前的 shell 环境变量

常见前端变量：

```text
NEXT_PUBLIC_API_BASE=https://your-backend.example.com/api/v2
NEXT_PUBLIC_SITE_URL=https://your-frontend.example.com
```

注意：

- 前端构建时会读取 `NEXT_PUBLIC_API_BASE`，如果要换域名，需要重新 `docker compose build frontend`
- `docker-compose.yml` 中的 `${VAR:-default}` 变量来自根目录 `.env` 或当前 shell，不来自 `env_file`
- 如果生产环境使用 HTTPS，API 地址也必须是 HTTPS
- 不要把真实密码提交到公开仓库

文献分享文章目录：

```text
LITERATURE_ARTICLE_ROOT=/app/media/literature/articles
LITERATURE_ASSET_ROOT=/app/media/literature/assets
```

默认正式发布目录是 `media/literature/articles`。文件命名使用 `YYYY-MM-DD_daily_digest.html`，例如：

```text
media/literature/articles/2026-05-20_daily_digest.html
```

系统只读取该正式发布目录。

如果 HTML 中包含本地 `file:///...` 图片路径，部署前运行：

```bash
docker compose exec backend python manage.py import_literature_assets
```

该命令会把图片复制到 `media/literature/assets/<日期>/`，并把文章中的图片地址改为 `/media/literature/assets/<日期>/<文件名>`。

## 3. 首次部署

```bash
docker compose build
docker compose up -d
```

`docker compose up -d` 会先启动 `db`，再运行一次性 `migrate`，迁移成功后再启动后端、前端和 worker。

创建管理员：

```bash
docker compose exec backend python manage.py createsuperuser
```

查看状态：

```bash
docker compose ps
```

## 4. 更新部署

拉取或同步代码后：

```bash
docker compose build
docker compose up -d
```

当前 Compose 会自动运行 `migrate` 服务，后端会等待迁移成功后再启动。

如果只改了前端环境变量，通常需要重新构建前端镜像：

```bash
docker compose build frontend
docker compose up -d frontend
```

## 5. 服务端口

默认端口映射：

- 数据库：`5432`
- 后端：`8001 -> 8000`
- 前端：`3000`

后端健康检查：

```bash
curl http://127.0.0.1:8001/healthz
```

## 6. 数据卷

Compose 中定义：

- `tsdb_data`：数据库数据
- `run_attachments`：批次附件和媒体文件

文献分享文章默认放在 `media/literature/articles`，生产环境应随 `media` 或 `/app/media` 一起持久化。

这些卷不能随意删除，否则会丢数据。

## 7. 迁移说明

推荐使用一次性迁移服务：

```bash
docker compose up migrate
```

如果后端已经启动，也可以手动执行：

```bash
docker compose exec backend python manage.py migrate
```

建议：

- 每次部署新版本后先执行迁移
- 迁移前做数据库备份
- 生产环境不要在不确认备份的情况下删除数据卷
- 如果 `migrate` 失败，`backend` 和 worker 不会继续启动，先看 `docker compose logs migrate`

## 8. MQTT 配置

当前 Compose 中 worker 使用外部 MQTT 服务配置：

```text
MQTT_HOST=118.25.108.254
MQTT_PORT=1883
```

如果更换 MQTT Broker，需要同步修改：

- `.env.backend`
- 设备端 `config.json`

通常不需要改 `docker-compose.yml`，worker 会从 `.env.backend` 读取 MQTT 配置。

## 9. 推荐上线检查

上线后按顺序检查：

1. `docker compose ps`
2. 后端 `/healthz`
3. 前端是否能打开
4. 登录是否正常
5. 设备是否能注册
6. 遥测是否进入数据库
7. 控制命令是否能下发
8. 自动控制 worker 是否正常运行

## 10. 日志查看

常用日志命令：

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mqtt_worker
docker compose logs -f mqtt_register_worker
docker compose logs -f auto_control_worker
docker compose logs -f db
```

如果只想看最近日志：

```bash
docker compose logs --tail=200 backend
```

## 11. 数据库备份与恢复

备份：

```bash
docker compose exec db pg_dump -U compostlab compostlab > backup.sql
```

恢复前请先确认环境和数据卷，避免覆盖生产数据：

```bash
docker compose exec -T db psql -U compostlab compostlab < backup.sql
```

## 12. 常见问题

### 后端容器一直 unhealthy

优先检查：

- 数据库是否 healthy
- `migrate` 是否成功退出
- 后端环境变量是否正确
- `/healthz` 是否能访问

常用命令：

```bash
docker compose ps
docker compose logs --tail=200 migrate
docker compose logs --tail=200 backend
```

### 前端无法请求后端

优先检查：

- `frontend/.env.production` 中的 `NEXT_PUBLIC_API_BASE`
- 浏览器控制台是否有 CORS 或 mixed content 报错
- 生产环境 HTTPS / HTTP 是否混用

### 设备在线但平台不更新

优先检查：

- MQTT Broker 地址和端口
- `mqtt_worker` 日志
- 设备上报 topic
- 遥测 payload 中的 `channels[].code`

### 能收到数据但指标显示不对

优先检查：

- 设备类型是否配置正确
- 通道 `code` 是否与固件一致
- 前端指标识别规则是否包含该设备类型
- MMCGS 控制器与点位关系是否正确

### 控制命令没有执行

优先检查：

- 设备是否在线
- 命令 topic 是否正确
- 设备固件是否支持该命令
- `DeviceCommand` 是否生成
- MQTT 下发 worker 是否正常

### 自动脚本没有触发

优先检查：

- `auto_control_worker` 是否运行
- 脚本是否启用
- 检查间隔是否合理
- 条件指标是否能取到最新数据
- Python 脚本是否有异常记录
