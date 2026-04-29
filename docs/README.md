# CompostLab V2 文档中心

这里是项目的正式文档入口。文档按用途收成少数几份，避免同一内容分散在多个文件里。

## 给普通用户

- [用户使用手册](./user-guide.md)
  - 登录、仪表盘、设备详情、控制脚本、运行批次、数据探索
- [设备说明手册](./device-guide.md)
  - CP500、MMCGS、SmartCompost 的结构、指标、展示与控制方式

## 给开发和维护人员

- [技术说明](./technical-guide.md)
  - 项目架构、后端模型、前端结构、自动控制、设备协议、API 与开发维护

## 给部署和运维人员

- [部署与运维](./deployment-guide.md)
  - Docker Compose、环境变量、迁移、服务启动、日志、备份与常见故障排查

## 维护原则

- 根目录只保留 `README.md`。
- 面向用户的说明放在 `user-guide.md` 和 `device-guide.md`。
- 面向开发的说明放在 `technical-guide.md`。
- 面向部署和排障的说明放在 `deployment-guide.md`。
