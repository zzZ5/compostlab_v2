# CompostLab 微信小程序

当前小程序使用原生微信小程序页面，直接调用 CompostLab 后端 API。

## 后端地址

```text
https://compostlab-backend-v2.cpolar.cn/api/v2
```

## 已实现页面

- `pages/login/index`：账号密码登录
- `pages/dashboard/index`：设备概览，读取 `/devices/tree?with_latest=1`
- `pages/device/detail`：设备详情和通道最新值
- `pages/device/control`：快捷命令和自定义 JSON 命令下发
- `pages/profile/index`：当前用户信息和退出登录

## 微信后台配置

在微信公众平台的小程序后台配置：

- request 合法域名：`https://compostlab-backend-v2.cpolar.cn`

如果后续使用 `web-view` 嵌入 Web 前端，再额外配置：

- 业务域名：`https://compostlab.cpolar.cn`

## 调试提示

开发者工具里可以临时开启“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”，但真机和发布版本必须在小程序后台配置合法域名。
